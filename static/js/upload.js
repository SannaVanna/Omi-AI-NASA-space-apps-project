/* ==========================================================================
   Omi AI — CSV Data Upload & Multi-Step Analysis Workflow
   Reads CSV headers locally for preview/configuration, submits real FormData
   to Flask backend, and renders results strictly from actual backend output.
   ========================================================================== */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var workspace = document.getElementById('upload-workspace');
    if (!workspace) return;

    var analysisEndpoint = workspace.getAttribute('data-analysis-endpoint') || '/api/uploads/analyze';

    var fileInput = document.getElementById('csv-file-input');
    var dropzone = document.getElementById('csv-dropzone');
    var browseBtn = document.getElementById('browse-file-btn');
    var replaceBtn = document.getElementById('replace-file-btn');
    var removeBtn = document.getElementById('remove-file-btn');

    var selectedFileBar = document.getElementById('selected-file-bar');
    var selectedFileName = document.getElementById('selected-file-name');
    var selectedFileMeta = document.getElementById('selected-file-meta');
    var fileErrorBanner = document.getElementById('file-error-banner');

    var step2Section = document.getElementById('step2-section');
    var step3Section = document.getElementById('step3-section');
    var step4Section = document.getElementById('step4-section');

    var previewContainer = document.getElementById('csv-preview-container');
    var dateSelect = document.getElementById('date-column-select');
    var valueSelect = document.getElementById('value-column-select');
    var dateHint = document.getElementById('date-suggestion-hint');
    var valueHint = document.getElementById('value-suggestion-hint');
    var variableSelect = document.getElementById('variable-select');
    var unitInput = document.getElementById('unit-input');
    var regionSelect = document.getElementById('region-select');
    var customRegionInput = document.getElementById('custom-region-input');
    var descriptionInput = document.getElementById('dataset-description');

    var analyseBtn = document.getElementById('analyse-dataset-btn');
    var validationError = document.getElementById('analysis-validation-error');
    var loadingBanner = document.getElementById('analysis-loading-banner');

    var currentFile = null;
    var parsedHeaders = [];
    var parsedSampleRows = [];

    function updateStepper(activeStep) {
      document.querySelectorAll('[data-step-indicator]').forEach(function (el) {
        var num = Number(el.getAttribute('data-step-indicator'));
        el.classList.toggle('is-active', num === activeStep);
        el.classList.toggle('is-complete', num < activeStep);
      });
    }

    function showFileError(msg) {
      if (!fileErrorBanner) return;
      fileErrorBanner.textContent = msg;
      fileErrorBanner.classList.remove('is-hidden');
    }

    function hideFileError() {
      if (fileErrorBanner) fileErrorBanner.classList.add('is-hidden');
    }

    function showValidationError(msg) {
      if (!validationError) return;
      validationError.textContent = msg;
      validationError.classList.remove('is-hidden');
    }

    function hideValidationError() {
      if (validationError) validationError.classList.add('is-hidden');
    }

    /**
     * RFC-4180 aware CSV line parser for reliable header & preview extraction
     */
    function parseCsvLines(text, maxRows) {
      var rows = [];
      var currentRow = [];
      var currentField = '';
      var inQuotes = false;
      var len = text.length;

      for (var i = 0; i < len; i++) {
        var ch = text[i];
        var next = text[i + 1];

        if (inQuotes) {
          if (ch === '"' && next === '"') {
            currentField += '"';
            i++;
          } else if (ch === '"') {
            inQuotes = false;
          } else {
            currentField += ch;
          }
        } else {
          if (ch === '"') {
            inQuotes = true;
          } else if (ch === ',') {
            currentRow.push(currentField.trim());
            currentField = '';
          } else if (ch === '\r' && next === '\n') {
            currentRow.push(currentField.trim());
            if (currentRow.some(function (c) { return c !== ''; })) rows.push(currentRow);
            currentRow = [];
            currentField = '';
            i++;
            if (rows.length >= maxRows) break;
          } else if (ch === '\n' || ch === '\r') {
            currentRow.push(currentField.trim());
            if (currentRow.some(function (c) { return c !== ''; })) rows.push(currentRow);
            currentRow = [];
            currentField = '';
            if (rows.length >= maxRows) break;
          } else {
            currentField += ch;
          }
        }
      }

      if (rows.length < maxRows && (currentField.length > 0 || currentRow.length > 0)) {
        currentRow.push(currentField.trim());
        if (currentRow.some(function (c) { return c !== ''; })) rows.push(currentRow);
      }

      return rows;
    }

    function formatBytes(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function looksLikeDateValue(val) {
      if (!val) return false;
      if (/^\d{4}[-/]\d{1,2}([-/]\d{1,2})?/.test(val)) return true;
      if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(val)) return true;
      if (/^(19|20)\d{2}$/.test(val)) return true;
      return !Number.isNaN(Date.parse(val)) && /[a-zA-Z\-/]/.test(val);
    }

    function suggestColumns(headers, sampleRows) {
      var dateIdx = -1;
      var valueIdx = -1;

      headers.forEach(function (h, idx) {
        var lower = h.toLowerCase();
        if (dateIdx === -1 && /(date|time|timestamp|year|month|day|period)/.test(lower)) {
          dateIdx = idx;
        }
      });

      if (dateIdx === -1 && sampleRows.length > 0) {
        headers.forEach(function (_, idx) {
          if (dateIdx === -1 && sampleRows.some(function (r) { return looksLikeDateValue(r[idx]); })) {
            dateIdx = idx;
          }
        });
      }

      // Suggest numeric column distinct from dateIdx
      headers.forEach(function (h, idx) {
        if (idx === dateIdx) return;
        var numericCount = sampleRows.filter(function (r) {
          var v = r[idx];
          return v !== undefined && v !== '' && !Number.isNaN(Number(v));
        }).length;

        if (numericCount > 0 && valueIdx === -1) {
          valueIdx = idx;
        } else if (numericCount > 0 && /(temp|rain|precip|t2m|value|mean|avg|measurement)/.test(h.toLowerCase())) {
          valueIdx = idx;
        }
      });

      return {
        dateCol: dateIdx >= 0 ? headers[dateIdx] : headers[0],
        valueCol: valueIdx >= 0 ? headers[valueIdx] : (headers[1] || headers[0]),
        dateSuggested: dateIdx >= 0,
        valueSuggested: valueIdx >= 0
      };
    }

    function renderPreviewTable(headers, rows) {
      if (!previewContainer) return;
      var thead = '<tr>' + headers.map(function (h) {
        return '<th>' + window.OmiUI.escapeHtml(h) + '</th>';
      }).join('') + '</tr>';

      var tbody = rows.slice(0, 5).map(function (row) {
        return '<tr>' + headers.map(function (_, idx) {
          return '<td>' + window.OmiUI.escapeHtml(row[idx] !== undefined ? row[idx] : '') + '</td>';
        }).join('') + '</tr>';
      }).join('');

      previewContainer.innerHTML =
        '<table class="data-table"><thead>' + thead + '</thead><tbody>' + tbody + '</tbody></table>';
    }

    function populateColumnSelectors(headers, sampleRows) {
      var suggestions = suggestColumns(headers, sampleRows);

      [dateSelect, valueSelect].forEach(function (sel) {
        if (!sel) return;
        sel.innerHTML = headers.map(function (h) {
          return '<option value="' + window.OmiUI.escapeHtml(h) + '">' + window.OmiUI.escapeHtml(h) + '</option>';
        }).join('');
      });

      if (dateSelect) dateSelect.value = suggestions.dateCol;
      if (valueSelect) valueSelect.value = suggestions.valueCol;

      if (dateHint) {
        dateHint.textContent = suggestions.dateSuggested
          ? 'Auto-suggested date/time column from header or format.'
          : 'Please confirm which column contains dates or timestamps.';
      }
      if (valueHint) {
        valueHint.textContent = suggestions.valueSuggested
          ? 'Auto-suggested numerical measurement column.'
          : 'Please select the numerical measurement column to analyse.';
      }

      // Suggest variable & unit if header name clearly indicates rainfall or temperature
      var valLower = (suggestions.valueCol || '').toLowerCase();
      var prefs = window.OmiUI.getPreferences();
      if (/rain|precip|prcp/.test(valLower)) {
        if (variableSelect) variableSelect.value = 'rainfall';
        if (unitInput) unitInput.value = prefs.rain_unit || 'mm';
      } else if (/temp|t2m|tas/.test(valLower)) {
        if (variableSelect) variableSelect.value = 'temperature';
        if (unitInput) unitInput.value = prefs.temp_unit || '°C';
      }
      if (regionSelect && (prefs.default_region === 'lagos' || prefs.default_region === 'edo')) {
        regionSelect.value = prefs.default_region;
      }
    }

    function clearFileSelection() {
      currentFile = null;
      parsedHeaders = [];
      parsedSampleRows = [];
      if (fileInput) fileInput.value = '';
      if (selectedFileBar) selectedFileBar.classList.add('is-hidden');
      if (dropzone) dropzone.classList.remove('is-hidden');
      if (step2Section) step2Section.classList.add('is-hidden');
      if (step3Section) step3Section.classList.add('is-hidden');
      if (step4Section) step4Section.classList.add('is-hidden');
      hideFileError();
      hideValidationError();
      updateStepper(1);
    }

    function handleSelectedFile(file) {
      hideFileError();
      hideValidationError();

      if (!file) return;
      if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
        showFileError('Please select a valid .csv file. Selected file: ' + file.name);
        return;
      }

      if (file.size === 0) {
        showFileError('The selected CSV file is empty (0 bytes).');
        return;
      }

      var reader = new FileReader();
      reader.onload = function (e) {
        var text = String(e.target.result || '');
        var rows = parseCsvLines(text, 25);
        if (rows.length < 2) {
          showFileError('Could not detect both a header row and data rows in this CSV file.');
          return;
        }

        parsedHeaders = rows[0].filter(Boolean);
        if (parsedHeaders.length < 2) {
          showFileError('CSV must contain at least 2 columns (a date/time column and a measurement column).');
          return;
        }

        parsedSampleRows = rows.slice(1);
        currentFile = file;

        if (selectedFileName) selectedFileName.textContent = file.name;
        if (selectedFileMeta) {
          selectedFileMeta.textContent = formatBytes(file.size) + ' · ' + parsedHeaders.length + ' columns detected';
        }
        if (selectedFileBar) selectedFileBar.classList.remove('is-hidden');
        if (dropzone) dropzone.classList.add('is-hidden');

        renderPreviewTable(parsedHeaders, parsedSampleRows);
        populateColumnSelectors(parsedHeaders, parsedSampleRows);

        if (step2Section) step2Section.classList.remove('is-hidden');
        if (step3Section) step3Section.classList.remove('is-hidden');
        if (step4Section) step4Section.classList.add('is-hidden');
        updateStepper(2);
      };

      reader.onerror = function () {
        showFileError('Unable to read the selected file in your browser.');
      };

      // Read first 256 KB for fast, responsive header & preview parsing
      reader.readAsText(file.slice(0, 262144));
    }

    if (browseBtn && fileInput) {
      browseBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        fileInput.click();
      });
    }

    if (replaceBtn && fileInput) {
      replaceBtn.addEventListener('click', function () {
        fileInput.click();
      });
    }

    if (removeBtn) {
      removeBtn.addEventListener('click', clearFileSelection);
    }

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', function () {
        fileInput.click();
      });

      dropzone.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileInput.click();
        }
      });

      dropzone.addEventListener('dragover', function (e) {
        e.preventDefault();
        dropzone.classList.add('is-dragover');
      });

      dropzone.addEventListener('dragleave', function () {
        dropzone.classList.remove('is-dragover');
      });

      dropzone.addEventListener('drop', function (e) {
        e.preventDefault();
        dropzone.classList.remove('is-dragover');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleSelectedFile(e.dataTransfer.files[0]);
        }
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files[0]) {
          handleSelectedFile(fileInput.files[0]);
        }
      });
    }

    if (variableSelect && unitInput) {
      variableSelect.addEventListener('change', function () {
        var v = variableSelect.value;
        var prefs = window.OmiUI.getPreferences();
        if (v === 'temperature') unitInput.value = prefs.temp_unit || '°C';
        else if (v === 'rainfall') unitInput.value = prefs.rain_unit || 'mm';
        else if (v === 'humidity') unitInput.value = '%';
        else if (v === 'solar_radiation') unitInput.value = 'W/m²';
      });
    }

    function renderKeyValTable(container, entries) {
      if (!container) return;
      if (!entries || entries.length === 0) {
        container.innerHTML = '<div style="padding: 16px; color: var(--text-muted); font-size: 0.875rem;">No additional fields returned by backend.</div>';
        return;
      }
      var rows = entries.map(function (pair) {
        return '<tr><td style="font-weight: 500;">' + window.OmiUI.escapeHtml(pair[0]) + '</td><td class="mono-value">' + window.OmiUI.escapeHtml(pair[1]) + '</td></tr>';
      }).join('');
      container.innerHTML = '<table class="data-table"><tbody>' + rows + '</tbody></table>';
    }

    function renderResults(payload) {
      if (!step4Section) return;
      step4Section.classList.remove('is-hidden');
      updateStepper(4);

      var fmt = window.OmiUI.formatNumber;
      var fmtP = window.OmiUI.formatP;
      var esc = window.OmiUI.escapeHtml;
      var stats = payload.statistics || {};
      var trend = payload.trend || {};
      var lr = trend.linear_regression || {};
      var sen = trend.sens_slope || {};
      var mk = trend.mann_kendall || {};
      var unit = payload.unit || (unitInput ? unitInput.value.trim() : '');
      var range = payload.date_range || {};
      var dateRangeText = (range.start || '—') + ' to ' + (range.end || '—');
      var conf = Math.round((sen.confidence_level || 0.95) * 100);

      var overviewMeta = document.getElementById('results-overview-meta');
      if (overviewMeta) {
        overviewMeta.textContent = (currentFile ? currentFile.name : 'Uploaded CSV') + ' · ' +
          (variableSelect ? variableSelect.options[variableSelect.selectedIndex].text : 'variable') + ' (' + unit + ')' +
          (payload.region ? ' · ' + payload.region : '');
      }

      var trendBadge = document.getElementById('results-trend-badge');
      if (trendBadge) trendBadge.textContent = 'Trend: ' + (trend.direction || '—');

      var rangeEl = document.getElementById('results-date-range');
      if (rangeEl) rangeEl.textContent = dateRangeText;

      var kpiStrip = document.getElementById('results-kpi-strip');
      if (kpiStrip) {
        kpiStrip.innerHTML =
          '<div class="kpi-cell"><div class="kpi-label">Valid Observations</div><div class="kpi-value">' + esc(stats.count) + '</div></div>' +
          '<div class="kpi-cell"><div class="kpi-label">Mean Value</div><div class="kpi-value">' + fmt(stats.mean, 2) + ' <span class="kpi-unit">' + esc(unit) + '</span></div></div>' +
          '<div class="kpi-cell"><div class="kpi-label">Rate (Sen\'s slope)</div><div class="kpi-value">' + fmt(sen.slope_per_decade, 3, true) + ' <span class="kpi-unit">' + esc(unit) + ' per decade</span></div></div>' +
          '<div class="kpi-cell"><div class="kpi-label">Trend Direction</div><div class="kpi-value kpi-text">' + esc(trend.direction || '—') + '</div></div>';
      }

      var chartContainer = document.getElementById('results-chart-container');
      var series = payload.series || [];
      if (chartContainer) {
        window.OmiUI.renderChart(chartContainer, {
          unit: unit,
          legend: true,
          series: [
            { name: 'Observations', color: '#168C83', points: series.map(function (pt) { return { label: pt.date, value: pt.value }; }) },
            { name: 'Linear trend', color: '#102A43', dashed: true, showPoints: false, points: (trend.trend_line || []).map(function (pt) { return { label: pt.date, value: pt.value }; }) }
          ]
        });
      }

      var statPairs = [
        ['Trend direction', trend.direction || '—'],
        ["Sen's slope", fmt(sen.slope_per_year, 4, true) + ' ' + unit + ' per year'],
        ["Sen's slope " + conf + '% CI', fmt((sen.confidence_interval_per_year || [])[0], 4, true) + ' to ' + fmt((sen.confidence_interval_per_year || [])[1], 4, true)],
        ['Linear regression slope', fmt(lr.slope_per_year, 4, true) + ' ' + unit + ' per year'],
        ['Regression ' + conf + '% CI', fmt((lr.confidence_interval_per_year || [])[0], 4, true) + ' to ' + fmt((lr.confidence_interval_per_year || [])[1], 4, true)],
        ['Regression R² / p-value', fmt(lr.r_squared, 3) + ' / ' + fmtP(lr.p_value)],
        [mk.test || 'Mann-Kendall', 'trend: ' + (mk.trend || '—') + ', tau ' + fmt(mk.tau, 3) + ', p ' + fmtP(mk.p_value)],
        ['Statistically significant (α = ' + (trend.alpha || 0.05) + ')', trend.significant ? 'Yes' : 'No']
      ];
      if (trend.seasonal_mann_kendall) {
        statPairs.push([trend.seasonal_mann_kendall.test, 'trend: ' + trend.seasonal_mann_kendall.trend + ', p ' + fmtP(trend.seasonal_mann_kendall.p_value)]);
      }
      renderKeyValTable(document.getElementById('results-statistics-table'), statPairs);

      var q = payload.data_quality || {};
      renderKeyValTable(document.getElementById('results-quality-table'), [
        ['Rows in file', q.rows_in_file],
        ['Valid observations used', q.valid_observations],
        ['Rows removed (invalid / duplicate dates)', q.rows_removed],
        ['Date range', dateRangeText],
        ['Mean / median', fmt(stats.mean, 3) + ' / ' + fmt(stats.median, 3) + ' ' + unit],
        ['Minimum / maximum', fmt(stats.minimum, 3) + ' / ' + fmt(stats.maximum, 3) + ' ' + unit],
        ['Standard deviation', fmt(stats.standard_deviation, 3) + ' ' + unit],
        ['Date column / value column', (q.date_column || '—') + ' / ' + (q.value_column || '—')]
      ]);

      step4Section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    if (analyseBtn) {
      analyseBtn.addEventListener('click', function () {
        hideValidationError();

        if (!currentFile) {
          showValidationError('Please select a CSV file in Step 1 before running analysis.');
          return;
        }

        var dateCol = dateSelect ? dateSelect.value : '';
        var valCol = valueSelect ? valueSelect.value : '';
        var unit = unitInput ? unitInput.value.trim() : '';

        if (!dateCol || !valCol) {
          showValidationError('Both a Date/Time column and a Measurement column must be selected.');
          return;
        }

        if (dateCol === valCol) {
          showValidationError('The Date/Time column and Measurement column cannot be the same column.');
          return;
        }

        if (!unit) {
          showValidationError('Please specify a measurement unit (for example °C or mm).');
          return;
        }

        updateStepper(3);
        analyseBtn.disabled = true;
        if (loadingBanner) loadingBanner.classList.remove('is-hidden');

        var formData = new FormData();
        formData.append('file', currentFile);
        formData.append('date_column', dateCol);
        formData.append('value_column', valCol);
        formData.append('variable', variableSelect ? variableSelect.value : 'temperature');
        formData.append('unit', unit);
        formData.append('region', regionSelect ? regionSelect.value : 'lagos');
        if (customRegionInput && customRegionInput.value.trim()) {
          formData.append('custom_region', customRegionInput.value.trim());
        }
        if (descriptionInput && descriptionInput.value.trim()) {
          formData.append('description', descriptionInput.value.trim());
        }
        formData.append('alpha', window.OmiUI.getPreferences().alpha);

        // Send to analysis endpoint (and handle non-OK or unimplemented backend honestly)
        fetch(analysisEndpoint, {
          method: 'POST',
          body: formData
        })
          .then(function (res) {
            return res.text().then(function (rawText) {
              var parsed = null;
              try {
                parsed = rawText ? JSON.parse(rawText) : null;
              } catch (e) {}

              if (!res.ok) {
                var errMsg = (parsed && (parsed.error || parsed.message)) || ('Backend returned HTTP ' + res.status);
                throw new Error(errMsg);
              }
              if (!parsed || parsed.error) {
                throw new Error((parsed && parsed.error) || 'Invalid JSON response from Flask backend.');
              }
              return parsed;
            });
          })
          .then(function (resultPayload) {
            renderResults(resultPayload);
          })
          .catch(function (err) {
            showValidationError(
              'Analysis could not be completed: ' + err.message
            );
          })
          .finally(function () {
            analyseBtn.disabled = false;
            if (loadingBanner) loadingBanner.classList.add('is-hidden');
          });
      });
    }
  });
})();
