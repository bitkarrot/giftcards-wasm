// Gift Cards Redeem Page — Vue 3 + Quasar, CSP-safe
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

  // --- Minimal bech32 encoder (for LNURL bech32 encoding) ---
  var BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

  function bech32Polymod(values) {
    var chk = 1;
    var GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    for (var i = 0; i < values.length; i++) {
      var top = chk >> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ values[i];
      for (var j = 0; j < 5; j++) {
        if ((top >> j) & 1) {
          chk ^= GEN[j];
        }
      }
    }
    return chk;
  }

  function bech32HrpExpand(hrp) {
    var ret = [];
    for (var i = 0; i < hrp.length; i++) {
      ret.push(hrp.charCodeAt(i) >> 5);
      ret.push(hrp.charCodeAt(i) & 31);
    }
    return ret;
  }

  function bech32CreateChecksum(hrp, data) {
    var values = bech32HrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
    var mod = bech32Polymod(values) ^ 1;
    var ret = [];
    for (var i = 0; i < 6; i++) {
      ret.push((mod >> (5 * (5 - i))) & 31);
    }
    return ret;
  }

  function convertBits(bytes, fromBits, toBits, pad) {
    var acc = 0, bits = 0;
    var ret = [];
    var maxv = (1 << toBits) - 1;
    for (var i = 0; i < bytes.length; i++) {
      acc = (acc << fromBits) | bytes[i];
      bits += fromBits;
      while (bits >= toBits) {
        bits -= toBits;
        ret.push((acc >> bits) & maxv);
      }
    }
    if (pad && bits) {
      ret.push((acc << (toBits - bits)) & maxv);
    }
    return ret;
  }

  function bech32Encode(hrp, bytes) {
    var data = convertBits(bytes, 8, 5, true);
    var checksum = bech32CreateChecksum(hrp, data);
    var combined = data.concat(checksum);
    var ret = hrp + '1';
    for (var i = 0; i < combined.length; i++) {
      ret += BECH32_CHARSET[combined[i]];
    }
    return ret;
  }

  // --- Vue app ---
  var app = Vue.createApp({
    render: window.REDEEM_RENDER_FN(),
    data: function () {
      return {
        giftCard: null,
        loading: true,
        tokenHash: null,
        error: false,
        copied: false,
        tab: 'bech32',
        nfcTagWriting: false,
        nfcSupported: typeof NDEFReader !== 'undefined'
      };
    },
    computed: {
      lnurlUrl: function () {
        if (!this.tokenHash) return '';
        var baseUrl = window.location.origin;
        return baseUrl + '/api/v1/ext/giftcards_wasm/lnurl/' + this.tokenHash;
      },
      lnurl: function () {
        if (!this.lnurlUrl) return '';
        if (this.tab === 'bech32') {
          var bytes = new TextEncoder().encode(this.lnurlUrl);
          var bech32 = bech32Encode('lnurl', Array.from(bytes));
          return 'lightning:' + bech32.toUpperCase();
        }
        // lud17: swap https:// -> lnurlw://
        return this.lnurlUrl.replace('https://', 'lnurlw://');
      },
      lnurlString: function () {
        if (!this.lnurl) return '';
        return this.lnurl.replace(/^(lightning|lnurlw):/i, '');
      }
    },
    watch: {
      tab: function () {
        var self = this;
        this.$nextTick(function () {
          self.renderQR();
        });
      }
    },
    mounted: function () {
      var self = this;
      this.loadGiftCard().then(function () {
        var params = new URLSearchParams(window.location.search);
        if (params.get('error') === '1') {
          self.error = true;
        }
        self.$nextTick(function () {
          self.renderQR();
        });
      });
    },
    methods: {
      clearError: function () {
        this.error = false;
      },

      async copyLnurl() {
        if (!this.lnurlString) return;
        try {
          await navigator.clipboard.writeText(this.lnurlString);
          this.copied = true;
          var self = this;
          setTimeout(function () { self.copied = false; }, 2000);
          this.$q.notify({ type: 'positive', message: 'LNURL copied to clipboard!' });
        } catch (e) {
          console.error('Failed to copy LNURL:', e);
          this.$q.notify({ type: 'negative', message: 'Failed to copy LNURL.' });
        }
      },

      async writeNfcTag() {
        try {
          if (!this.nfcSupported) {
            throw {
              toString: function () {
                return 'NFC not supported on this device or browser.';
              }
            };
          }
          var ndef = new NDEFReader();
          this.nfcTagWriting = true;
          this.$q.notify({
            message: 'Tap your NFC tag to write the LNURL-withdraw link to it.'
          });
          await ndef.write({
            records: [{ recordType: 'url', data: this.lnurl, lang: 'en' }]
          });
          this.nfcTagWriting = false;
          this.$q.notify({ type: 'positive', message: 'NFC tag written successfully.' });
        } catch (error) {
          this.nfcTagWriting = false;
          this.$q.notify({
            type: 'negative',
            message: error ? error.toString() : 'An unexpected error has occurred.'
          });
        }
      },

      printCard: function () {
        try {
          window.print();
        } catch (e) {
          // Sandbox may block window.print() — try opening in new tab via bridge
          var self = this;
          var dataUrl = this.getCardDataUrl();
          if (dataUrl) {
            window.LNbitsBridge.connect().then(function () {
              return window.LNbitsBridge.openInNewTab(dataUrl);
            }).catch(function () {
              self.$q.notify({
                type: 'negative',
                message: 'Printing is not available in this context.'
              });
            });
          }
        }
      },

      downloadCard: function () {
        var dataUrl = this.getCardDataUrl();
        if (!dataUrl) {
          this.$q.notify({ type: 'negative', message: 'No image to download.' });
          return;
        }
        var link = document.createElement('a');
        link.href = dataUrl;
        link.download = 'giftcard_' + (this.tokenHash ? this.tokenHash.slice(0, 8) : 'card') + '.png';
        document.body.appendChild(link);
        var clicked = false;
        try { link.click(); clicked = true; } catch (e) {}
        document.body.removeChild(link);
        if (!clicked) {
          // Sandbox may block download — try opening in new tab via bridge
          var self = this;
          window.LNbitsBridge.connect().then(function () {
            return window.LNbitsBridge.openInNewTab(dataUrl);
          }).then(function () {
            self.$q.notify({
              type: 'positive',
              message: 'Image opened in new tab — right-click to save.'
            });
          }).catch(function () {
            self.$q.notify({
              type: 'negative',
              message: 'Could not download. Right-click the QR code to save it.'
            });
          });
        }
      },

      getCardDataUrl: function () {
        // Use the branded canvas if available, otherwise the QR canvas
        var canvas = this.$refs.brandedCanvas || this.$refs.qrCanvas;
        if (!canvas) return null;
        try {
          return canvas.toDataURL('image/png');
        } catch (e) {
          return null;
        }
      },

      renderQR: function () {
        if (!this.giftCard || this.giftCard.status !== 'active' || !this.lnurl) return;
        var self = this;

        if (this.giftCard.hasDesign) {
          this.renderBrandedCard();
        } else {
          this.$nextTick(function () {
            var canvas = self.$refs.qrCanvas;
            if (canvas && window.QRCode) {
              window.QRCode.toCanvas(canvas, self.lnurl, { width: 250 }, function () {});
            }
          });
        }
      },

      renderBrandedCard: function () {
        var self = this;
        this.$nextTick(function () {
          var canvas = self.$refs.brandedCanvas;
          if (!canvas) return;

          var ctx = canvas.getContext('2d');
          var W = 400, H = 540;
          canvas.width = W;
          canvas.height = H;

          // White background
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, W, H);

          // Border
          ctx.strokeStyle = '#1976d2';
          ctx.lineWidth = 3;
          ctx.strokeRect(10, 10, W - 20, H - 20);

          // Title
          ctx.fillStyle = '#1976d2';
          ctx.font = 'bold 24px Roboto, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('Gift Card', W / 2, 50);

          // Amount
          ctx.fillStyle = '#333';
          ctx.font = 'bold 32px Roboto, sans-serif';
          ctx.fillText((self.giftCard.amount || 0) + ' sats', W / 2, 100);

          // Sender / recipient
          ctx.font = '14px Roboto, sans-serif';
          ctx.textAlign = 'left';
          var y = 140;
          if (self.giftCard.recipientName) {
            ctx.fillText('To: ' + self.giftCard.recipientName, 30, y);
            y += 24;
          }
          if (self.giftCard.senderName) {
            ctx.fillText('From: ' + self.giftCard.senderName, 30, y);
            y += 24;
          }
          if (self.giftCard.message) {
            ctx.fillText('Message: ' + self.giftCard.message, 30, y);
            y += 24;
          }

          // QR code — render to an offscreen canvas, then composite
          y += 10;
          var qrSize = 200;
          var qrX = (W - qrSize) / 2;
          var qrCanvas = document.createElement('canvas');
          if (window.QRCode) {
            window.QRCode.toCanvas(qrCanvas, self.lnurl, { width: qrSize }, function () {
              ctx.drawImage(qrCanvas, qrX, y, qrSize, qrSize);

              // LNURL string at bottom
              y += qrSize + 20;
              ctx.font = '11px Roboto, sans-serif';
              ctx.fillStyle = '#666';
              ctx.textAlign = 'center';
              var url = self.lnurlString || '';
              if (url.length > 55) url = url.substring(0, 52) + '...';
              ctx.fillText(url, W / 2, y);
            });
          }
        });
      },

      async loadGiftCard() {
        this.loading = true;
        try {
          // Get raw token from URL path: /ext/giftcards_wasm/redeem/{token}
          var pathParts = window.location.pathname.split('/');
          var rawToken = '';
          for (var i = 0; i < pathParts.length; i++) {
            if (pathParts[i] === 'redeem' && i + 1 < pathParts.length) {
              rawToken = pathParts[i + 1];
              break;
            }
          }

          if (!rawToken || rawToken === 'redeem') {
            this.giftCard = null;
            return;
          }

          // Compute SHA-256 hash in the browser
          this.tokenHash = await this.computeSHA256(rawToken);

          // Load public card data via bridge
          var card = await apiCall('GET', '/cards/public/' + this.tokenHash, null);

          if (card && !card.error && !card.detail) {
            this.giftCard = card;
          } else {
            this.giftCard = null;
          }
        } catch (error) {
          console.error('Failed to load gift card:', error);
          this.giftCard = null;
        } finally {
          this.loading = false;
        }
      },

      async computeSHA256(message) {
        var msgBuffer = new TextEncoder().encode(message);
        var hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        var hashArray = Array.from(new Uint8Array(hashBuffer));
        var hashHex = hashArray.map(function (b) {
          return b.toString(16).padStart(2, '0');
        }).join('');
        return hashHex;
      },

      formatDate: function (dateString) {
        if (!dateString) return '';
        // expiresAt / expiredAt may be a unix timestamp string
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
