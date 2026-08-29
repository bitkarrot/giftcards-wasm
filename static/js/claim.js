// Gift Cards Claim Page — Vue 3 + Quasar, CSP-safe
// Uses bridge (postMessage) instead of fetch (blocked by connect-src 'none')
(function () {
  'use strict';

  var API_BASE = '/api/v1/ext/giftcards_wasm';

  async function apiCall(method, path, body) {
    await window.LNbitsBridge.connect();
    var result = await window.LNbitsBridge.callApi(method, API_BASE + path, body);
    if (result && typeof result === 'object' && 'ok' in result && 'data' in result) {
      return result.data;
    }
    return result;
  }

  var app = Vue.createApp({
    render: window.CLAIM_RENDER_FN(),
    data: function () {
      return {
        claimState: 'entry',  // entry, confirm, rate_limited, loading, cards, invalid
        email: '',
        pendingCards: [],
        submitting: false
      };
    },
    mounted: function () {
      // Check if route has :magic_token — if so, verify the magic link
      // URL pattern: /ext/giftcards_wasm/claim/{token}
      var path = window.location.pathname;
      var match = path.match(/\/claim\/(.+)$/);
      if (match && match[1]) {
        this.claimState = 'loading';
        this.verifyMagicLink(match[1]);
      }
    },
    methods: {
      isValidEmail: function (val) {
        var re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(val);
      },

      async submitClaim() {
        if (!this.email || !this.isValidEmail(this.email)) {
          return;
        }
        this.submitting = true;
        try {
          var res = await apiCall('POST', '/claim', { email: this.email });
          // The WASM API always returns the same message regardless of
          // whether cards were found or rate-limited (no email enumeration).
          // Check for error field in case the bridge resolves with an error.
          if (res && res.error && res.error.toLowerCase().indexOf('rate') !== -1) {
            this.claimState = 'rate_limited';
          } else {
            // Always show confirmation (no email enumeration)
            this.claimState = 'confirm';
          }
        } catch (error) {
          // Network/bridge error — still show confirmation to avoid revealing state
          this.claimState = 'confirm';
        } finally {
          this.submitting = false;
        }
      },

      async verifyMagicLink(token) {
        try {
          var res = await apiCall('GET', '/claim/' + token, null);
          // Check for error response (invalid/expired link)
          if (res && (res.error || res.detail)) {
            this.claimState = 'invalid';
            return;
          }
          var cards = (res && res.cards) || [];
          this.pendingCards = cards;
          this.claimState = 'cards';
        } catch (error) {
          // Bridge rejection — invalid or expired link
          this.claimState = 'invalid';
        }
      },

      resetClaim: function () {
        this.claimState = 'entry';
        this.email = '';
        this.pendingCards = [];
      },

      requestNewLink: function () {
        // Navigate back to the claim entry page
        var self = this;
        window.LNbitsBridge.connect().then(function () {
          return window.LNbitsBridge.replaceRoute('/ext/giftcards_wasm/claim');
        }).catch(function () {
          // Fallback: just reset the state
          self.resetClaim();
        });
      },

      formatDate: function (dateString) {
        if (!dateString) return '';
        var date;
        if (/^\d+$/.test(dateString)) {
          date = new Date(parseInt(dateString, 10) * 1000);
        } else {
          date = new Date(dateString);
        }
        return date.toLocaleDateString();
      }
    }
  });

  app.use(Quasar);
  app.mount('#q-app');
})();
