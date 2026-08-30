/**
 * LNbits WASM Extension Bridge Client
 *
 * Provides a simple async API for iframe content to communicate with
 * the parent LNbits page via the MessageChannel bridge.
 */
window.LNbitsBridge = (function() {
  let port = null;
  let connected = false;
  let pendingRequests = new Map();
  let requestIdCounter = 0;
  let bridgeContext = null;
  let contextPromise = null;

  function connect() {
    return new Promise((resolve, reject) => {
      if (connected && port) {
        resolve(bridgeContext);
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Bridge connection timeout'));
      }, 10000);

      // Send connect message to parent
      const messageId = 'connect-' + (++requestIdCounter);
      const channel = new MessageChannel();

      channel.port1.onmessage = function(event) {
        const msg = event.data;
        if (!msg) return;

        if (msg.type === 'lnbits-extension:connected') {
          clearTimeout(timeout);
          port = channel.port1;
          connected = true;
          port.onmessage = handleMessage;
          // Fetch context
          fetchContext().then(ctx => {
            bridgeContext = ctx;
            resolve(ctx);
          }).catch(reject);
        } else if (msg.type === 'lnbits-extension:response') {
          handleResponse(msg);
        }
      };

      window.parent.postMessage({
        type: 'lnbits-extension:connect',
        id: messageId
      }, '*', [channel.port2]);
    });
  }

  function handleMessage(event) {
    const msg = event.data;
    if (!msg) return;
    if (msg.type === 'lnbits-extension:response') {
      handleResponse(msg);
    }
  }

  function handleResponse(msg) {
    const pending = pendingRequests.get(msg.id);
    if (!pending) return;
    pendingRequests.delete(msg.id);
    if (msg.ok) {
      pending.resolve(msg.data);
    } else {
      pending.reject(new Error(msg.error || 'Bridge request failed'));
    }
  }

  function sendRequest(action, data) {
    return new Promise((resolve, reject) => {
      if (!port) {
        reject(new Error('Bridge not connected'));
        return;
      }
      const id = 'req-' + (++requestIdCounter);
      pendingRequests.set(id, { resolve, reject });
      port.postMessage({
        type: 'lnbits-extension:request',
        id: id,
        action: action,
        ...data
      });
    });
  }

  function fetchContext() {
    if (contextPromise) return contextPromise;
    contextPromise = sendRequest('context', {});
    return contextPromise;
  }

  async function callApi(method, path, body) {
    const data = { method: method.toUpperCase(), path: path };
    if (body !== undefined && body !== null) {
      data.body = body;
    }
    const result = await sendRequest('api', data);
    return result;
  }

  async function getRouteParams() {
    if (!bridgeContext) {
      bridgeContext = await fetchContext();
    }
    return bridgeContext.routeParams || {};
  }

  async function getQuery() {
    if (!bridgeContext) {
      bridgeContext = await fetchContext();
    }
    return bridgeContext.query || {};
  }

  function notify(message, type) {
    return sendRequest('ui.notify', { message: message, type: type || 'info' });
  }

  function replaceRoute(path) {
    return sendRequest('navigation.replace', { path: path });
  }

  function openInNewTab(url) {
    return sendRequest('navigation.open_new_tab', { url: url });
  }

  // Copy text to the clipboard. The iframe has `clipboard-write` permission
  // via the `allow` attribute, so this works inside the sandbox.
  //
  // Note: The iframe sandbox (allow-scripts only, no allow-same-origin,
  // no allow-downloads) and the parent's navigation.open_new_tab (HTTP/HTTPS
  // only, no data: URIs) make real file downloads impossible without
  // modifying LNbits core. As a workaround, we copy the content to the
  // clipboard and show it in a dialog so the user can paste it into a file.
  function copyToClipboard(text) {
    return navigator.clipboard.writeText(text);
  }

  return {
    connect: connect,
    callApi: callApi,
    getRouteParams: getRouteParams,
    getQuery: getQuery,
    notify: notify,
    replaceRoute: replaceRoute,
    openInNewTab: openInNewTab,
    copyToClipboard: copyToClipboard,
    getContext: function() { return bridgeContext; }
  };
})();
