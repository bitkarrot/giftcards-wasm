/**
 * Gift Cards WASM Extension — Vue 3 + Quasar component
 *
 * Ports the Python extension's index.js to run inside an iframe sandbox,
 * using the LNbitsBridge for all API calls and Quasar dialogs instead of
 * native confirm()/alert()/window.open().
 */
(function () {
  'use strict';

  // API base path for the WASM extension
  var API_BASE = '/api/v1/ext/giftcards_wasm';
  // Static asset base for template images
  var IMG_BASE = '/ext-assets/giftcards_wasm/image';

  window.PageGiftCards = {
    render: window.INDEX_RENDER_FN(),
    data() {
      return {
        giftCards: [],
        loading: false,
        walletBalance: 0,
        // Wallet info from bridge context (no g.user global in WASM)
        walletId: null,
        tablePagination: {
          rowsPerPage: 10
        },
        createDialog: {
          show: false,
          loading: false,
          data: {
            amount: null,
            recipient_name: '',
            sender_name: '',
            message: '',
            expires_at: null,
            designMode: 'none'
          },
          result: null
        },
        // Card designer state
        selectedTemplate: 'portrait',
        templateAssetId: null,
        templateUrl: IMG_BASE + '/template_portrait.png',
        sampleTemplates: [
          {value: 'GiftBoxes',         label: 'Gift Boxes',          w: 825, h: 638},
          {value: 'GiftCard',          label: 'Gift Card',           w: 825, h: 638},
          {value: 'HappyBirthday',     label: 'Happy Birthday',      w: 825, h: 638},
          {value: 'MerryXmas',         label: 'Merry Xmas',          w: 825, h: 638},
          {value: 'OrangeCard',        label: 'Orange Card',         w: 825, h: 638},
          {value: 'PurpleGift',        label: 'Purple Gift',         w: 825, h: 638},
          {value: 'SatsGiftCard',      label: 'Sats Gift Card',      w: 825, h: 638},
          {value: 'SeasonsGreetings',  label: "Season's Greetings",  w: 825, h: 638}
        ],
        qrX: 21,
        qrY: 228,
        qrSize: 150,
        textX: 21,
        textY: 33,
        selectedFont: 'DejaVuSans',
        fontSize: 24,
        fontColor: '#000000',
        bgColor: '#ebedf5',
        textAlign: 'left',
        showAmount: true,
        showRecipient: true,
        showMessage: true,
        previewWidth: 212,
        previewHeight: 325,
        actualTemplateWidth: 425,
        actualTemplateHeight: 650,
        minQrSize: 150,
        dragState: null,
        resizeState: null,
        isUploadingTemplate: false,
        templateAssetStaged: false,
        designLoaded: false,
        // Email delivery dialog
        emailDialog: {
          show: false,
          loading: false,
          card: null,
          data: {
            recipient_email: '',
            email_mode: 'custom',
            subject: '',
            body: '',
            template: 'notification',
            bg_color: '#1976d2'
          }
        },
        // Bulk create dialog
        bulkDialog: {
          show: false,
          loading: false,
          activeTab: 'same',
          sameData: {
            count: null,
            amount: null,
            recipient_name: '',
            sender_name: '',
            message: '',
            expires_at: null,
            designMode: 'none'
          },
          csvData: {
            designMode: 'none'
          },
          csvFile: null,
          csvRows: [],
          csvErrors: 0,
          csvParsing: false,
          csvErrorRows: []
        },
        // Card detail dialog
        detailDialog: {
          show: false,
          card: null,
          cardImageUrl: null
        },
        // Dashboard filters
        dashboardFilters: {
          status: null,
          search: '',
          dateFrom: null,
          dateTo: null,
          dateRangeLabel: ''
        },
        dateRange: null,
        // Multi-select
        selectedCards: [],
        bulkEmailLoading: false,
        // Bulk email confirmation dialog
        bulkEmailDialog: {
          show: false,
          loading: false,
          scope: 'filtered',
          cards: [],
          selected: [],
          skipped: 0
        },
        // Card edit dialog
        editDialog: {
          show: false,
          loading: false,
          card: null,
          data: {
            recipient_name: '',
            sender_name: '',
            message: '',
            recipient_email: '',
            designMode: 'none'
          }
        },
        // Delete confirmation dialog
        deleteDialog: {
          show: false,
          loading: false,
          card: null
        },
        // Bulk delete confirmation dialog
        bulkDeleteDialog: {
          show: false,
          loading: false,
          count: 0,
          activeAmount: 0,
          cardIds: []
        }
      };
    },
    computed: {
      giftCardColumns() {
        return [
          {
            name: 'recipientName',
            align: 'left',
            label: 'Recipient',
            field: row => row.recipientName || 'Anonymous',
            sortable: true
          },
          {
            name: 'status',
            align: 'left',
            label: 'Status',
            field: 'status',
            sortable: true
          },
          {
            name: 'delivery',
            align: 'left',
            label: 'Delivery',
            field: row => row.emailStatus || 'not_sent',
            sortable: true
          },
          {
            name: 'expiresAt',
            align: 'left',
            label: 'Expires',
            field: row => row.expiresAt ? this.formatDate(row.expiresAt) : 'Never',
            sortable: true
          }
        ];
      },
      templateOptions() {
        var samples = this.sampleTemplates.map(function (s) {
          return { label: s.label, value: s.value };
        });
        return [
          { label: 'Portrait (425x650)', value: 'portrait' },
          { label: 'Landscape (1050x600)', value: 'landscape' }
        ].concat(samples, [{ label: 'Custom Upload', value: 'custom' }]);
      },
      fontOptions() {
        return [
          { label: 'DejaVu Sans', value: 'DejaVuSans' },
          { label: 'DejaVu Serif', value: 'DejaVuSerif' },
          { label: 'DejaVu Sans Mono', value: 'DejaVuSansMono' }
        ];
      },
      anyTextShown() {
        return this.showAmount || this.showRecipient || this.showMessage;
      },
      bgColorEnabled() {
        return this.selectedTemplate === 'portrait' || this.selectedTemplate === 'landscape';
      },
      cardPreviewStyle() {
        var style = { width: this.previewWidth + 'px', height: this.previewHeight + 'px' };
        if (this.bgColorEnabled) {
          style.backgroundColor = this.bgColor;
        }
        return style;
      },
      previewScale() {
        if (!this.actualTemplateWidth) return 1;
        return this.previewWidth / this.actualTemplateWidth;
      },
      previewQrSize() {
        return Math.round(this.qrSize * this.previewScale);
      },
      emailModeOptions() {
        return [
          { label: 'Custom Text', value: 'custom' },
          { label: 'Fancy HTML Template', value: 'fancy' }
        ];
      },
      previewTextStyle() {
        var alignMap = { left: 'left', center: 'center', right: 'right' };
        var fontFamilyMap = {
          DejaVuSans: 'sans-serif',
          DejaVuSerif: 'serif',
          DejaVuSansMono: 'monospace'
        };
        return {
          fontFamily: fontFamilyMap[this.selectedFont] || 'sans-serif',
          fontSize: Math.round(this.fontSize * this.previewScale) + 'px',
          color: this.fontColor,
          textAlign: alignMap[this.textAlign] || 'left',
          lineHeight: '1.3'
        };
      },
      previewTextTransform() {
        if (this.textAlign === 'center') return 'translateX(-50%)';
        if (this.textAlign === 'right') return 'translateX(-100%)';
        return 'none';
      },
      bulkSubmitLabel() {
        if (this.bulkDialog.activeTab === 'csv') {
          var validCount = this.bulkDialog.csvRows.length;
          return 'Create ' + validCount + ' Cards';
        }
        return 'Create ' + (this.bulkDialog.sameData.count || 0) + ' Cards';
      },
      bulkSubmitDisabled() {
        if (this.bulkDialog.activeTab === 'csv') {
          return this.bulkDialog.csvErrors > 0 ||
                 this.bulkDialog.csvRows.length === 0 ||
                 this.bulkDialog.csvRows.length > 500;
        }
        var count = this.bulkDialog.sameData.count;
        var amount = this.bulkDialog.sameData.amount;
        return count <= 0 || amount <= 0 || (count * amount > this.walletBalance);
      },
      bulkTotalExceedsBalance() {
        var count = this.bulkDialog.sameData.count || 0;
        var amount = this.bulkDialog.sameData.amount || 0;
        return count * amount > this.walletBalance;
      },
      csvValidationColumns() {
        return [
          { name: 'rowIndex', align: 'left', label: '#', field: 'rowIndex', sortable: false },
          { name: 'status', align: 'left', label: 'Status', field: 'valid', sortable: false },
          { name: 'recipient_name', align: 'left', label: 'Recipient', field: 'recipient_name', sortable: false },
          { name: 'amount_sats', align: 'right', label: 'Amount', field: 'amount_sats', sortable: false },
          { name: 'recipient_email', align: 'left', label: 'Email', field: 'recipient_email', sortable: false },
          { name: 'nostr_npub', align: 'left', label: 'Npub', field: 'nostr_npub', sortable: false },
          { name: 'errors', align: 'left', label: 'Errors', field: 'errors', sortable: false }
        ];
      },
      csvValidationTableRows() {
        var self = this;
        var validRows = this.bulkDialog.csvRows.map(function (r) {
          return {
            rowIndex: r.row_num,
            valid: true,
            recipient_name: r.recipient_name,
            amount_sats: r.amount_sats,
            recipient_email: r.recipient_email,
            nostr_npub: r.nostr_npub,
            errors: []
          };
        });
        var errorRows = this.bulkDialog.csvErrorRows.map(function (e) {
          return {
            rowIndex: e.row_num,
            valid: false,
            recipient_name: '',
            amount_sats: '',
            recipient_email: '',
            nostr_npub: '',
            errors: [e.field + ': ' + e.message]
          };
        });
        return validRows.concat(errorRows).sort(function (a, b) {
          return a.rowIndex - b.rowIndex;
        });
      },
      statusFilterOptions() {
        return [
          { label: 'Active', value: 'active' },
          { label: 'Redeemed', value: 'redeemed' },
          { label: 'Expired', value: 'expired' }
        ];
      },
      anyFilterActive() {
        return !!(this.dashboardFilters.status ||
                  this.dashboardFilters.search ||
                  this.dashboardFilters.dateFrom ||
                  this.dashboardFilters.dateTo);
      },
      allSelected() {
        return this.giftCards.length > 0 &&
               this.selectedCards.length === this.giftCards.length;
      }
    },
    mounted() {
      var self = this;
      window.LNbitsBridge.connect().then(function () {
        self.loadGiftCards();
        self.loadWalletBalance();
      }).catch(function (err) {
        console.error('Bridge connection failed:', err);
        self.$q.notify({ message: 'Failed to connect to LNbits bridge', type: 'negative' });
      });
    },
    methods: {
      // ----- Bridge API helpers -----

      /**
       * Call the WASM extension API via the bridge.
       * Unwraps the { ok, data } response envelope and returns the data.
       */
      async apiCall(method, path, body) {
        var result = await window.LNbitsBridge.callApi(method, API_BASE + path, body);
        // The API returns { ok: true, data: ... } — unwrap it
        if (result && typeof result === 'object' && 'ok' in result && 'data' in result) {
          return result.data;
        }
        return result;
      },

      notifyError(error) {
        var msg = (error && error.message) ? error.message : 'Request failed';
        this.$q.notify({ message: msg, type: 'negative' });
      },

      toggleSelectAll(val, rows) {
        if (val) {
          this.selectedCards = (rows || this.giftCards).slice();
        } else {
          this.selectedCards = [];
        }
      },

      async loadGiftCards() {
        this.loading = true;
        try {
          var params = new URLSearchParams();
          if (this.dashboardFilters.status) {
            params.append('status', this.dashboardFilters.status);
          }
          if (this.dashboardFilters.search) {
            params.append('search', this.dashboardFilters.search);
          }
          if (this.dashboardFilters.dateFrom) {
            params.append('date_from', this.dashboardFilters.dateFrom);
          }
          if (this.dashboardFilters.dateTo) {
            params.append('date_to', this.dashboardFilters.dateTo);
          }
          var queryString = params.toString();
          var path = '/cards' + (queryString ? '?' + queryString : '');
          var data = await this.apiCall('GET', path, null);
          this.giftCards = data || [];
        } catch (error) {
          this.notifyError(error);
        } finally {
          this.loading = false;
        }
      },

      async loadWalletBalance() {
        // Wallet balance API is not available to WASM extensions via the bridge.
        // Sats locking is disabled in the WASM version, so we set balance to
        // Infinity to effectively skip balance checks in the UI.
        this.walletBalance = Infinity;
      },

      openCreateDialog() {
        this.createDialog.show = true;
        this.resetCreateDialog();
      },

      resetCreateDialog() {
        this.createDialog.data = {
          amount: null,
          recipient_name: '',
          sender_name: '',
          message: '',
          expires_at: null,
          designMode: 'none'
        };
        this.createDialog.result = null;
        if (this.templateAssetId && this.templateAssetStaged) {
          this.deleteAssetFile(this.templateAssetId);
        }
        this.templateAssetStaged = false;
        this.selectedTemplate = 'portrait';
        this.templateAssetId = null;
        this.templateUrl = IMG_BASE + '/template_portrait.png';
        this.qrX = 21;
        this.qrY = 228;
        this.qrSize = 150;
        this.textX = 21;
        this.textY = 33;
        this.selectedFont = 'DejaVuSans';
        this.fontSize = 24;
        this.fontColor = '#000000';
        this.bgColor = '#ebedf5';
        this.textAlign = 'left';
        this.showAmount = true;
        this.showRecipient = true;
        this.showMessage = true;
        this.previewWidth = 212;
        this.previewHeight = 325;
        this.actualTemplateWidth = 425;
        this.actualTemplateHeight = 650;
        this.dragState = null;
        this.resizeState = null;
      },

      async createGiftCard() {
        this.createDialog.loading = true;
        try {
          var designMode = this.createDialog.data.designMode;
          var d = this.createDialog.data;
          var payload = {
            amount: d.amount,
            recipientName: d.recipient_name || '',
            senderName: d.sender_name || '',
            message: d.message || '',
            expiresAt: d.expires_at || null,
            design: designMode === 'shared' ? this.buildDesignConfig() : null
          };
          var data = await this.apiCall('POST', '/cards', payload);
          this.createDialog.result = data;
          await this.loadGiftCards();
          this.loadWalletBalance();
          this.templateAssetStaged = false;
          this.$q.notify({ message: 'Gift card created successfully!', type: 'positive' });
        } catch (error) {
          this.notifyError(error);
        } finally {
          this.createDialog.loading = false;
        }
      },

      async copyToClipboard(text) {
        try {
          await navigator.clipboard.writeText(text);
        } catch (error) {
          var textArea = document.createElement('textarea');
          textArea.value = text;
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
        }
      },

      formatDate(dateString) {
        if (!dateString) return '';
        var date = new Date(dateString);
        return date.toLocaleDateString();
      },

      getStatusColor(status) {
        switch (status) {
          case 'active': return 'positive';
          case 'created': return 'grey-6';
          case 'redeemed': return 'grey-6';
          case 'expired': return 'warning';
          default: return 'grey';
        }
      },

      getStatusText(status) {
        switch (status) {
          case 'active': return 'Active';
          case 'created': return 'Created';
          case 'redeemed': return 'Redeemed';
          case 'expired': return 'Expired';
          default: return status;
        }
      },

      getDeliveryStatusColor(status) {
        switch (status) {
          case 'not_sent': return 'grey-6';
          case 'sent': return 'positive';
          case 'failed': return 'negative';
          default: return 'grey';
        }
      },

      getDeliveryStatusText(status) {
        switch (status) {
          case 'not_sent': return 'Not sent';
          case 'sent': return 'Sent';
          case 'failed': return 'Failed';
          default: return status;
        }
      },

      /**
       * Download a printable gift card image. The WASM backend doesn't have
       * a /print endpoint, so we composite the image client-side using a
       * canvas (template background + QR code + text overlay).
       */
      async downloadPrintable(card) {
        try {
          // Fetch full card details to get the redemption URL / token
          var detail = await this.apiCall('GET', '/cards/' + card.id, null);
          var redemptionUrl = detail.redemptionUrl || '';
          if (!redemptionUrl && (detail.token || detail.raw_token)) {
            redemptionUrl = window.location.origin + '/ext/giftcards_wasm/redeem/' + (detail.token || detail.raw_token);
          }

          // Build a composite image on a canvas
          var canvas = document.createElement('canvas');
          var design = detail.design;
          var hasDesign = design && design.templateName;

          if (hasDesign) {
            // Use the design's template dimensions
            var tw = this.actualTemplateWidth;
            var th = this.actualTemplateHeight;
            // Try to get dimensions from the design or sample template
            var sample = this.sampleTemplates.find(function (s) {
              return s.value === design.templateName;
            });
            if (design.templateName === 'portrait') { tw = 425; th = 650; }
            else if (design.templateName === 'landscape') { tw = 1050; th = 600; }
            else if (sample) { tw = sample.w; th = sample.h; }
            else { tw = 425; th = 650; }

            canvas.width = tw;
            canvas.height = th;
            var ctx = canvas.getContext('2d');

            // Fill background
            if (design.templateName === 'portrait' || design.templateName === 'landscape') {
              ctx.fillStyle = design.bg_color || '#ebedf5';
              ctx.fillRect(0, 0, tw, th);
            } else {
              // Load template image
              var imgUrl;
              if (design.templateName === 'custom' && design.templateAssetId) {
                imgUrl = API_BASE + '/cards/template/' + design.templateAssetId;
              } else {
                imgUrl = IMG_BASE + '/template_' + design.templateName + '.png';
              }
              await this._loadImageAndDraw(ctx, imgUrl, tw, th);
            }

            // Draw QR code
            if (redemptionUrl) {
              var qrCanvas = document.createElement('canvas');
              await new Promise(function (resolve, reject) {
                window.QRCode.toCanvas(qrCanvas, redemptionUrl, { width: 300 }, function (err) {
                  if (err) reject(err); else resolve();
                });
              });
              var qrSize = design.qr_size || 150;
              var qrX = Math.round((design.qr_x_frac || 0.1) * tw);
              var qrY = Math.round((design.qr_y_frac || 0.7) * th);
              ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);
            }

            // Draw text
            if (design.show_amount !== false || design.show_recipient !== false || design.show_message !== false) {
              var fontFamilyMap = {
                DejaVuSans: 'sans-serif',
                DejaVuSerif: 'serif',
                DejaVuSansMono: 'monospace'
              };
              ctx.font = (design.font_size || 24) + 'px ' + (fontFamilyMap[design.font_family] || 'sans-serif');
              ctx.fillStyle = design.font_color || '#000000';
              ctx.textAlign = design.text_align || 'left';
              var textX = Math.round((design.text_x_frac || 0.1) * tw);
              var textY = Math.round((design.text_y_frac || 0.1) * th);
              var lineHeight = (design.font_size || 24) * 1.3;
              var y = textY + (design.font_size || 24);

              if (design.show_amount !== false) {
                ctx.fillText((detail.amount || card.amount || 0) + ' sats', textX, y);
                y += lineHeight;
              }
              if (design.show_recipient !== false) {
                ctx.fillText('For: ' + (detail.recipientName || card.recipientName || 'Recipient'), textX, y);
                y += lineHeight;
              }
              if (design.show_message !== false) {
                ctx.fillText(detail.message || card.message || 'Your message', textX, y);
              }
            }
          } else {
            // No design — bare QR card
            canvas.width = 400;
            canvas.height = 500;
            var ctx2 = canvas.getContext('2d');
            ctx2.fillStyle = '#ffffff';
            ctx2.fillRect(0, 0, 400, 500);
            ctx2.strokeStyle = '#1976d2';
            ctx2.lineWidth = 3;
            ctx2.strokeRect(10, 10, 380, 480);

            ctx2.fillStyle = '#1976d2';
            ctx2.font = 'bold 24px sans-serif';
            ctx2.textAlign = 'center';
            ctx2.fillText('Bitcoin Lightning Gift Card', 200, 50);

            ctx2.fillStyle = '#333';
            ctx2.font = '20px sans-serif';
            ctx2.fillText((detail.amount || card.amount || 0) + ' sats', 200, 85);

            if (redemptionUrl) {
              var qrCanvas2 = document.createElement('canvas');
              await new Promise(function (resolve, reject) {
                window.QRCode.toCanvas(qrCanvas2, redemptionUrl, { width: 250 }, function (err) {
                  if (err) reject(err); else resolve();
                });
              });
              ctx2.drawImage(qrCanvas2, 75, 110, 250, 250);
            }

            ctx2.fillStyle = '#666';
            ctx2.font = '12px sans-serif';
            ctx2.textAlign = 'center';
            var url = redemptionUrl || '';
            if (url.length > 55) url = url.substring(0, 52) + '...';
            ctx2.fillText(url, 200, 400);

            if (detail.recipientName || card.recipientName) {
              ctx2.fillText('For: ' + (detail.recipientName || card.recipientName), 200, 430);
            }
            if (detail.senderName || card.senderName) {
              ctx2.fillText('From: ' + (detail.senderName || card.senderName), 200, 450);
            }
          }

          var dataUrl = canvas.toDataURL('image/png');
          var link = document.createElement('a');
          link.download = 'giftcard_' + (card.id || card.card_id) + '.png';
          link.href = dataUrl;
          link.click();
          this.$q.notify({ message: 'Gift card image downloaded', type: 'positive' });
        } catch (error) {
          console.error('Download failed:', error);
          this.notifyError(error);
        }
      },

      _loadImageAndDraw(ctx, url, w, h) {
        return new Promise(function (resolve, reject) {
          var img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = function () {
            ctx.drawImage(img, 0, 0, w, h);
            resolve();
          };
          img.onerror = function () {
            // If the image fails to load, fill with white background
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
            resolve();
          };
          img.src = url;
        });
      },

      exportCSV(scope) {
        var cards;
        if (scope === 'selected') {
          cards = this.selectedCards;
        } else {
          cards = this.giftCards;
        }
        if (cards.length === 0) {
          this.$q.notify({ message: 'No gift cards to export', type: 'warning' });
          return;
        }

        var headers = [
          'card_id', 'amount', 'status', 'recipient_name', 'sender_name',
          'message', 'recipient_email', 'email_status', 'redemption_url',
          'created_at', 'expires_at', 'redeemed_at'
        ];
        var rows = cards.map(function (card) {
          return [
            card.id, card.amount, card.status,
            card.recipientName || '', card.senderName || '',
            card.message || '', card.recipientEmail || '',
            card.emailStatus || '', card.redemptionUrl || '',
            card.createdAt || '', card.expiresAt || '', card.redeemedAt || ''
          ];
        });

        var csv = headers.join(',') + '\n';
        rows.forEach(function (row) {
          csv += row.map(function (cell) {
            return '"' + cell + '"';
          }).join(',') + '\n';
        });

        var blob = new Blob([csv], { type: 'text/csv' });
        var url = window.URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        var suffix = scope === 'selected' ? 'selected' : 'filtered';
        a.download = 'giftcards_' + suffix + '_' + new Date().toISOString().split('T')[0] + '.csv';
        a.click();
        window.URL.revokeObjectURL(url);
        this.$q.notify({ message: 'CSV exported successfully', type: 'positive' });
      },

      // ----- Card Designer: drag interaction -----

      startDrag(event, target) {
        event.preventDefault();
        this.dragState = {
          target: target,
          startX: event.clientX,
          startY: event.clientY,
          origX: target === 'qr' ? this.qrX : this.textX,
          origY: target === 'qr' ? this.qrY : this.textY
        };
        event.target.setPointerCapture(event.pointerId);
      },

      onDrag(event) {
        if (!this.dragState) return;
        var dx = event.clientX - this.dragState.startX;
        var dy = event.clientY - this.dragState.startY;
        var newX = this.dragState.origX + dx;
        var newY = this.dragState.origY + dy;
        if (this.dragState.target === 'qr') {
          var pqrs = this.previewQrSize;
          this.qrX = Math.max(0, Math.min(newX, this.previewWidth - pqrs));
          this.qrY = Math.max(0, Math.min(newY, this.previewHeight - pqrs));
        } else {
          this.textX = Math.max(0, Math.min(newX, this.previewWidth));
          this.textY = Math.max(0, Math.min(newY, this.previewHeight));
        }
      },

      endDrag() {
        this.dragState = null;
      },

      // ----- Card Designer: QR resize -----

      startResize(event) {
        event.preventDefault();
        this.resizeState = {
          startX: event.clientX,
          origSize: this.qrSize
        };
        event.target.setPointerCapture(event.pointerId);
      },

      onResize(event) {
        if (!this.resizeState) return;
        var dx = event.clientX - this.resizeState.startX;
        var scale = this.previewScale || 1;
        var deltaActual = dx / scale;
        var newSize = Math.max(this.minQrSize, this.resizeState.origSize + deltaActual);
        var maxPreviewSize = this.previewWidth - this.qrX;
        var maxActualSize = maxPreviewSize / scale;
        this.qrSize = Math.min(newSize, maxActualSize);
      },

      endResize() {
        this.resizeState = null;
      },

      // ----- Card Designer: template selection & upload -----

      onTemplateChange(value) {
        if (value !== 'custom') {
          if (this.templateAssetId && this.templateAssetStaged) {
            this.deleteAssetFile(this.templateAssetId);
          }
          this.templateAssetStaged = false;
          this.templateAssetId = null;
        }

        if (value === 'portrait') {
          this.actualTemplateWidth = 425;
          this.actualTemplateHeight = 650;
          this.previewWidth = 212;
          this.previewHeight = 325;
          this.templateUrl = IMG_BASE + '/template_portrait.png';
        } else if (value === 'landscape') {
          this.actualTemplateWidth = 1050;
          this.actualTemplateHeight = 600;
          this.previewWidth = 262;
          this.previewHeight = 150;
          this.templateUrl = IMG_BASE + '/template_landscape.png';
        } else if (value !== 'custom') {
          var sample = this.sampleTemplates.find(function (s) { return s.value === value; });
          if (sample) {
            this.actualTemplateWidth = sample.w;
            this.actualTemplateHeight = sample.h;
            var scale = 300 / sample.w;
            this.previewWidth = Math.round(sample.w * scale);
            this.previewHeight = Math.round(sample.h * scale);
            this.templateUrl = IMG_BASE + '/template_' + value + '.png';
          }
        }
        if (value !== 'custom') {
          this.qrX = Math.round(0.1 * this.previewWidth);
          this.qrY = Math.round(0.7 * this.previewHeight);
          this.textX = Math.round(0.1 * this.previewWidth);
          this.textY = Math.round(0.1 * this.previewHeight);
        }
      },

      triggerTemplateUpload() {
        this.$refs.templateUpload.value = null;
        this.$refs.templateUpload.click();
      },

      async handleTemplateSelected(event) {
        var file = event.target.files && event.target.files[0];
        if (!file) return;

        var dims;
        try {
          dims = await this._getImageDimensions(file);
          if (dims.width > 1500 || dims.height > 2000) {
            this.$q.notify({ message: 'Template image too large. Maximum dimensions are 1500x2000px.', type: 'negative' });
            return;
          }
        } catch (err) {
          this.$q.notify({ message: 'Could not read image file.', type: 'negative' });
          return;
        }

        this.isUploadingTemplate = true;
        try {
          if (this.templateAssetId && this.templateAssetStaged) {
            await this.deleteAssetFile(this.templateAssetId);
          }
          var assetId = await this.uploadAssetFile(file);
          this.templateAssetId = assetId;
          this.templateAssetStaged = true;
          this.templateUrl = API_BASE + '/cards/template/' + assetId;
          this.actualTemplateWidth = dims.width;
          this.actualTemplateHeight = dims.height;
          var maxPreview = 325;
          if (dims.width >= dims.height) {
            this.previewWidth = maxPreview;
            this.previewHeight = Math.round(maxPreview * dims.height / dims.width);
          } else {
            this.previewHeight = maxPreview;
            this.previewWidth = Math.round(maxPreview * dims.width / dims.height);
          }
          this.$q.notify({ message: 'Custom template uploaded', type: 'positive' });
        } catch (error) {
          this.notifyError(error);
        } finally {
          this.isUploadingTemplate = false;
        }
      },

      _getImageDimensions(file) {
        return new Promise(function (resolve, reject) {
          var url = URL.createObjectURL(file);
          var img = new Image();
          img.onload = function () {
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
            URL.revokeObjectURL(url);
          };
          img.onerror = function (err) {
            URL.revokeObjectURL(url);
            reject(err);
          };
          img.src = url;
        });
      },

      async uploadAssetFile(file) {
        // The bridge callApi supports FormData bodies
        var form = new FormData();
        form.append('file', file);
        var data = await this.apiCall('POST', '/cards/template', form);
        return data.id;
      },

      async deleteAssetFile(assetId) {
        try {
          await this.apiCall('DELETE', '/cards/template/' + assetId, null);
        } catch (error) {
          console.warn('Failed to delete previous template:', error);
        }
      },

      // ----- Email delivery dialog -----

      isValidEmail(val) {
        if (!val) return false;
        var re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(val);
      },

      openEmailDialog(card) {
        this.emailDialog.card = card;
        this.emailDialog.data = {
          recipient_email: card.recipientEmail || '',
          email_mode: 'custom',
          subject: 'You have a gift card from ' + (card.senderName || 'Anonymous'),
          body: '',
          template: 'notification',
          bg_color: '#1976d2'
        };
        this.emailDialog.show = true;
      },

      async sendEmail() {
        if (!this.emailDialog.card) return;
        if (!this.isValidEmail(this.emailDialog.data.recipient_email)) {
          this.$q.notify({ message: 'Enter a valid email address.', type: 'negative' });
          return;
        }
        this.emailDialog.loading = true;
        try {
          var d = this.emailDialog.data;
          var payload = {
            recipientEmail: d.recipient_email,
            emailMode: d.email_mode || 'custom',
            subject: d.subject || '',
            body: d.body || '',
            template: d.template || 'notification',
            bgColor: d.bg_color || '#1976d2'
          };
          await this.apiCall('POST', '/cards/' + this.emailDialog.card.id + '/deliver', payload);
          this.emailDialog.show = false;
          this.$q.notify({ message: 'Email sent successfully', type: 'positive' });
          await this.loadGiftCards();
        } catch (error) {
          this.notifyError(error);
        } finally {
          this.emailDialog.loading = false;
        }
      },

      // ----- Bulk create dialog -----

      openBulkDialog() {
        this.bulkDialog.show = true;
        this.bulkDialog.activeTab = 'same';
        this.bulkDialog.sameData = {
          count: null,
          amount: null,
          recipient_name: '',
          sender_name: '',
          message: '',
          expires_at: null,
          designMode: 'none'
        };
        this.bulkDialog.csvFile = null;
        this.bulkDialog.csvRows = [];
        this.bulkDialog.csvErrors = 0;
        this.bulkDialog.csvErrorRows = [];
        this.bulkDialog.csvData = { designMode: 'none' };
        if (this.templateAssetId && this.templateAssetStaged) {
          this.deleteAssetFile(this.templateAssetId);
        }
        this.templateAssetStaged = false;
        this.selectedTemplate = 'portrait';
        this.templateAssetId = null;
        this.templateUrl = IMG_BASE + '/template_portrait.png';
        this.qrX = 21;
        this.qrY = 228;
        this.qrSize = 150;
        this.textX = 21;
        this.textY = 33;
        this.selectedFont = 'DejaVuSans';
        this.fontSize = 24;
        this.fontColor = '#000000';
        this.bgColor = '#ebedf5';
        this.textAlign = 'left';
        this.showAmount = true;
        this.showRecipient = true;
        this.showMessage = true;
        this.previewWidth = 212;
        this.previewHeight = 325;
        this.actualTemplateWidth = 425;
        this.actualTemplateHeight = 650;
      },

      async submitBulkCreate() {
        this.bulkDialog.loading = true;
        try {
          if (this.bulkDialog.activeTab === 'csv') {
            var design = null;
            if (this.bulkDialog.csvData.designMode === 'shared') {
              design = this.buildDesignConfig();
            }
            var csvPayload = {
              rows: this.bulkDialog.csvRows,
              design_mode: this.bulkDialog.csvData.designMode,
              design: design
            };
            await this.apiCall('POST', '/cards/bulk', csvPayload);
            this.bulkDialog.show = false;
            var csvCount = this.bulkDialog.csvRows.length;
            this.templateAssetStaged = false;
            this.$q.notify({ message: csvCount + ' gift cards created successfully!', type: 'positive' });
            this.clearFilters();
            this.loadWalletBalance();
          } else {
            var design2 = null;
            if (this.bulkDialog.sameData.designMode === 'shared') {
              design2 = this.buildDesignConfig();
            }
            var samePayload = {
              count: this.bulkDialog.sameData.count,
              amount: this.bulkDialog.sameData.amount,
              recipientName: this.bulkDialog.sameData.recipient_name || null,
              senderName: this.bulkDialog.sameData.sender_name || null,
              message: this.bulkDialog.sameData.message || null,
              expiresAt: this.bulkDialog.sameData.expires_at || null,
              design: design2
            };
            await this.apiCall('POST', '/cards/bulk', samePayload);
            this.bulkDialog.show = false;
            var count = this.bulkDialog.sameData.count;
            this.templateAssetStaged = false;
            this.$q.notify({ message: count + ' gift cards created successfully!', type: 'positive' });
            this.clearFilters();
            this.loadWalletBalance();
          }
        } catch (error) {
          this.notifyError(error);
        } finally {
          this.bulkDialog.loading = false;
        }
      },

      // ----- CSV upload -----

      async onCsvFileSelected(file) {
        if (!file) return;
        var filename = file.name || '';
        if (!filename.toLowerCase().endsWith('.csv')) {
          this.$q.notify({ message: 'Please select a CSV file.', type: 'negative' });
          return;
        }
        this.bulkDialog.csvParsing = true;
        try {
          var formData = new FormData();
          formData.append('file', file);
          var data = await this.apiCall('POST', '/cards/validate-csv', formData);
          this.bulkDialog.csvRows = data.valid_rows || [];
          this.bulkDialog.csvErrorRows = data.errors || [];
          this.bulkDialog.csvErrors = data.error_count || 0;
        } catch (error) {
          this.notifyError(error);
          this.bulkDialog.csvRows = [];
          this.bulkDialog.csvErrorRows = [];
          this.bulkDialog.csvErrors = 0;
        } finally {
          this.bulkDialog.csvParsing = false;
        }
      },

      downloadCsvTemplate() {
        var headers = 'recipient_name,amount_sats,recipient_email,nostr_npub,sender_name,message';
        var exampleRow = 'Alice,1000,alice@example.com,,Bob,Happy birthday!';
        var csv = headers + '\n' + exampleRow + '\n';
        var blob = new Blob([csv], { type: 'text/csv' });
        var url = window.URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'giftcards_bulk_template.csv';
        a.click();
        window.URL.revokeObjectURL(url);
      },

      // ----- Card detail / edit / delete dialogs -----

      async openDetailDialog(card) {
        this.detailDialog.card = card;
        this.detailDialog.cardImageUrl = null;
        this.detailDialog.show = true;
        try {
          var data = await this.apiCall('GET', '/cards/' + card.id + '?include_link=true', null);
          this.detailDialog.card = data;
          if (data.tokenHash) {
            this.detailDialog.cardImageUrl = API_BASE + '/cards/' + data.tokenHash + '/image?t=' + Date.now();
          }
        } catch (error) {
          console.error('Failed to load card details:', error);
        }
      },

      async openEditDialog(card) {
        this.editDialog.card = card;
        this.editDialog.data = {
          recipient_name: card.recipientName || '',
          sender_name: card.senderName || '',
          message: card.message || '',
          recipient_email: card.recipientEmail || ''
        };
        this.resetCardDesigner();
        this.editDialog.data.designMode = 'none';
        this.designLoaded = false;
        this.editDialog.show = true;
        try {
          var data = await this.apiCall('GET', '/cards/' + card.id, null);
          if (data && data.design) {
            this.applyDesignToDesigner(data.design);
            this.editDialog.data.designMode = 'shared';
          }
          this.designLoaded = true;
        } catch (error) {
          console.error('Failed to load card design for edit:', error);
          this.$q.notify({ message: 'Could not load card design — only metadata will be saved.', type: 'warning' });
        }
      },

      resetCardDesigner() {
        if (this.templateAssetId && this.templateAssetStaged) {
          this.deleteAssetFile(this.templateAssetId);
        }
        this.templateAssetStaged = false;
        this.selectedTemplate = 'portrait';
        this.templateAssetId = null;
        this.templateUrl = IMG_BASE + '/template_portrait.png';
        this.qrX = 21;
        this.qrY = 228;
        this.qrSize = 150;
        this.textX = 21;
        this.textY = 33;
        this.selectedFont = 'DejaVuSans';
        this.fontSize = 24;
        this.fontColor = '#000000';
        this.bgColor = '#ebedf5';
        this.textAlign = 'left';
        this.showAmount = true;
        this.showRecipient = true;
        this.showMessage = true;
        this.previewWidth = 212;
        this.previewHeight = 325;
        this.actualTemplateWidth = 425;
        this.actualTemplateHeight = 650;
        this.dragState = null;
        this.resizeState = null;
      },

      applyDesignToDesigner(design) {
        if (design.templateName && design.templateName !== 'custom') {
          this.selectedTemplate = design.templateName;
          this.onTemplateChange(design.templateName);
        } else if (design.templateName === 'custom') {
          this.selectedTemplate = 'custom';
          this.templateAssetId = design.templateAssetId || null;
          this.templateAssetStaged = false;
          if (design.templateAssetId) {
            this.templateUrl = API_BASE + '/cards/template/' + design.templateAssetId;
          }
        } else {
          this.templateAssetId = design.templateAssetId || null;
          this.templateAssetStaged = false;
        }
        this.qrX = Math.round((design.qr_x_frac || 0.1) * this.previewWidth);
        this.qrY = Math.round((design.qr_y_frac || 0.7) * this.previewHeight);
        this.qrSize = design.qr_size || 150;
        this.textX = Math.round((design.text_x_frac || 0.1) * this.previewWidth);
        this.textY = Math.round((design.text_y_frac || 0.1) * this.previewHeight);
        this.selectedFont = design.font_family || 'DejaVuSans';
        this.fontSize = design.font_size || 24;
        this.fontColor = design.font_color || '#000000';
        this.bgColor = design.bg_color || '#ebedf5';
        this.textAlign = design.text_align || 'left';
        this.showAmount = design.show_amount !== false;
        this.showRecipient = design.show_recipient !== false;
        this.showMessage = design.show_message !== false;
      },

      buildDesignConfig() {
        return {
          template_asset_id: this.templateAssetId,
          template_name: this.selectedTemplate,
          qr_x_frac: this.qrX / this.previewWidth,
          qr_y_frac: this.qrY / this.previewHeight,
          qr_size: this.qrSize,
          text_x_frac: this.textX / this.previewWidth,
          text_y_frac: this.textY / this.previewHeight,
          font_family: this.selectedFont,
          font_size: this.fontSize,
          font_color: this.fontColor,
          bg_color: this.bgColor,
          text_align: this.textAlign,
          show_amount: this.showAmount,
          show_recipient: this.showRecipient,
          show_message: this.showMessage
        };
      },

      async saveCardEdit() {
        if (!this.editDialog.card) return;
        this.editDialog.loading = true;
        try {
          var designMode = this.editDialog.data.designMode;
          var d = this.editDialog.data;
          var payload = {
            recipientName: d.recipient_name || '',
            senderName: d.sender_name || '',
            message: d.message || '',
            recipientEmail: d.recipient_email || ''
          };
          if (this.designLoaded) {
            if (designMode === 'shared') {
              payload.design = this.buildDesignConfig();
            } else {
              payload.clear_design = true;
            }
          }
          await this.apiCall('PUT', '/cards/' + this.editDialog.card.id, payload);
          this.editDialog.show = false;
          this.templateAssetStaged = false;
          this.$q.notify({ message: 'Card updated successfully', type: 'positive' });
          await this.loadGiftCards();
        } catch (error) {
          this.notifyError(error);
        } finally {
          this.editDialog.loading = false;
        }
      },

      openDeleteDialog(card) {
        this.deleteDialog.card = card;
        this.deleteDialog.show = true;
      },

      async confirmDelete() {
        if (!this.deleteDialog.card) return;
        this.deleteDialog.loading = true;
        try {
          var card = this.deleteDialog.card;
          var cardId = card.id || card.card_id;
          var data = await this.apiCall('DELETE', '/cards/' + cardId, null);
          this.deleteDialog.show = false;
          var reclaimed = (data && data.reclaimed_sats) || 0;
          this.$q.notify({ message: 'Card deleted and ' + reclaimed + ' sats reclaimed', type: 'positive' });
          await this.loadGiftCards();
          this.loadWalletBalance();
        } catch (error) {
          this.notifyError(error);
        } finally {
          this.deleteDialog.loading = false;
        }
      },

      openBulkDeleteDialog() {
        if (this.selectedCards.length === 0) return;
        var activeCards = this.selectedCards.filter(function (c) { return c.status === 'active'; });
        this.bulkDeleteDialog.count = this.selectedCards.length;
        this.bulkDeleteDialog.activeAmount = activeCards.reduce(function (sum, c) {
          return sum + (c.amount || 0);
        }, 0);
        this.bulkDeleteDialog.cardIds = this.selectedCards.map(function (c) { return c.id; });
        this.bulkDeleteDialog.show = true;
      },

      async confirmBulkDelete() {
        if (this.bulkDeleteDialog.cardIds.length === 0) return;
        this.bulkDeleteDialog.loading = true;
        try {
          var data = await this.apiCall('DELETE', '/cards/bulk', { card_ids: this.bulkDeleteDialog.cardIds });
          this.bulkDeleteDialog.show = false;
          var deleted = (data && data.deleted) || 0;
          var reclaimed = (data && data.reclaimed_sats) || 0;
          var msg = deleted + ' card' + (deleted === 1 ? '' : 's') + ' deleted';
          if (reclaimed > 0) {
            msg += ' and ' + reclaimed + ' sats reclaimed';
          }
          this.$q.notify({ message: msg, type: 'positive' });
          this.selectedCards = [];
          await this.loadGiftCards();
          this.loadWalletBalance();
        } catch (error) {
          this.notifyError(error);
        } finally {
          this.bulkDeleteDialog.loading = false;
        }
      },

      // ----- Dashboard filters -----

      applyFilters() {
        this.selectedCards = [];
        this.loadGiftCards();
      },

      clearFilters() {
        this.dashboardFilters = {
          status: null,
          search: '',
          dateFrom: null,
          dateTo: null,
          dateRangeLabel: ''
        };
        this.dateRange = null;
        this.selectedCards = [];
        this.loadGiftCards();
      },

      // ----- Bulk email sending -----

      sendBulkEmails(scope) {
        var targetCards;
        if (scope === 'selected') {
          targetCards = this.selectedCards;
        } else {
          targetCards = this.giftCards;
        }
        var emailable = targetCards.filter(function (c) { return c.recipientEmail; });
        var skipped = targetCards.length - emailable.length;
        this.bulkEmailDialog.scope = scope;
        this.bulkEmailDialog.cards = emailable;
        this.bulkEmailDialog.selected = emailable.slice();
        this.bulkEmailDialog.skipped = skipped;
        this.bulkEmailDialog.show = true;
      },

      async confirmBulkEmails() {
        this.bulkEmailDialog.loading = true;
        this.bulkEmailLoading = true;
        var sent = 0;
        var failed = 0;
        try {
          for (var i = 0; i < this.bulkEmailDialog.selected.length; i++) {
            var card = this.bulkEmailDialog.selected[i];
            try {
              await this.apiCall('POST', '/cards/' + card.id + '/deliver', {
                recipient_email: card.recipientEmail,
                email_mode: 'custom',
                subject: 'You have a gift card from ' + (card.senderName || 'Anonymous'),
                body: ''
              });
              sent++;
            } catch (err) {
              failed++;
            }
          }
          var skipped = this.bulkEmailDialog.skipped;
          var msg = sent + ' emails sent, ' + skipped + ' skipped (no email address)';
          if (failed > 0) {
            this.$q.notify({ message: msg + ', ' + failed + ' failed', type: 'warning' });
          } else {
            this.$q.notify({ message: msg, type: 'positive' });
          }
          this.bulkEmailDialog.show = false;
          await this.loadGiftCards();
        } catch (error) {
          this.notifyError(error);
        } finally {
          this.bulkEmailDialog.loading = false;
          this.bulkEmailLoading = false;
        }
      }
    }
  };

  // Mount the Vue app with Quasar
  function mountApp() {
    var app = Vue.createApp(window.PageGiftCards);
    app.use(Quasar, {
      config: {
        notify: {}
      }
    });
    app.mount('#q-app');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountApp);
  } else {
    mountApp();
  }
})();
