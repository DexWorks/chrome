/**
 * A DevTools controller for background page.
 *
 * For generic CSS patching extension uses CSSOM
 * which is very fast even on large sources. The problem is
 * that these changes in CSSOM are not reflected into original
 * source, e.g. in DevTools you’ll still see unchanges properties.
 * Moreover, any change in DevTools will reset all CSSOM changes.
 *
 * This module keeps track of all pending diffs for tabs and
 * when DevTools for tab became available, it flushes these 
 * changes to DevTools page so it can apply diffs on page resources.
 */
'use strict';

import portExpect from '../lib/port-expect';

var openedDevtools = {};
var pendingPatches = {};

var devtoolsPort = /^devtools\-page:(\d+)$/;

export function saveDiff(tabId, stylesheetUrl, patches) {
	if (isOpenedForTab(tabId)) {
		// we have opened DevTools for this tab,
		// send diff directly to it
		console.log('DevTools opened, send diff directly');
		return getPort(tabId).postMessage({
			name: 'diff',
			data: {
				uri: stylesheetUrl,
				syntax: 'css', // always CSS
				patches: patches
			}
		});
	}

	// no opened DevTools, accumulate changes
	if (!pendingPatches[tabId]) {
		pendingPatches[tabId] = {};
	}

	if (!pendingPatches[tabId][stylesheetUrl]) {
		pendingPatches[tabId][stylesheetUrl] = [];
	}

	console.log('Append patches for', stylesheetUrl);
	pendingPatches[tabId][stylesheetUrl] = pendingPatches[tabId][stylesheetUrl].concat(patches);
}

export function getPort(tabId) {
	if (typeof tabId === 'object') {
		tabId = tabId.id;
	}

	return openedDevtools[tabId];
}

export function isOpenedForTab(tabId) {
	return !!getPort(tabId);
}

/**
 * Resets current DevTools state for given tab id
 */
export function reset(tabId) {
	var port = getPort(tabId);
	if (port) {
		port.postMessage({name: 'reset'});
	}
}

export function stylesheets(tabId, callback) {
	if (!this.isOpenedForTab(tabId)) {
		return callback([]);
	}

	return portExpect(getPort(tabId), 'get-stylesheets', 'stylesheets')
	.then(callback, err => callback([]));
}

export function stylesheetContent(tabId, url) {
	if (!this.isOpenedForTab(tabId)) {
		return callback([]);
	}

	return portExpect(getPort(tabId), 'get-stylesheet-content', {url}, 'stylesheet-content')
	.then(resp => resp.content);
}

function normalizeUrl(url) {
	return url.split('#')[0];
}

/**
 * Show log messages coming from DevTools
 * @param  {Array} strings Array of string
 */
function devtoolsLog(strings) {
	var args = ['%c[DevTools]', 'background-color:#344a5d;color:#fff'].concat(strings);
	console.log.apply(console, args);
}

/**
 * Handles incoming messages from DevTools connection port
 * @param  {Object} message Incoming message
 */
function devtoolsMessageHandler(tabId, message) {
	if (message.name === 'log') {
		devtoolsLog(message.data);
	} else if (message.name === 'resource-updated') {
		// notify tabs about updates resources
		chrome.tabs.sendMessage(tabId, message);
	}
}

function resetPatches(tabId) {
	if (tabId in pendingPatches) {
		delete pendingPatches[tabId];
	}
}

chrome.runtime.onConnect.addListener(function(port) {
	var m = port.name.match(devtoolsPort);
	if (m) {
		var tabId = +m[1];
		openedDevtools[tabId] = port;
		console.log('Opened devtools for', tabId);

		if (tabId in pendingPatches) {
			// flush pending patches
			port.postMessage({
				name: 'pending-patches',
				data: pendingPatches[tabId]
			});
			delete pendingPatches[tabId];
		}

		var messageHandler = message => {
			devtoolsMessageHandler(tabId, message);
		};

		port.onMessage.addListener(messageHandler);

		port.onDisconnect.addListener(function() {
			console.log('Closed devtools for', tabId);
			delete openedDevtools[tabId];
			port.onMessage.removeListener(messageHandler);
		});
	}
});

// cleanup patches when tab is closed or refreshed
chrome.tabs.onRemoved.addListener(resetPatches);
chrome.tabs.onUpdated.addListener(resetPatches);