/* ==========================================================================
   Omi AI — Text & Voice Assistant Client
   Sends messages to the Flask assistant, keeps the investigation state the
   server returns (region, variable, period), renders charts from real
   analysis results, and supports voice via the browser's Web Speech API.
   Never shows a simulated answer if the backend is unavailable.
   ========================================================================== */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('assistant-root');
    if (!root) return;

    var chatEndpoint = root.getAttribute('data-assistant-endpoint') || '/api/assistant/chat';
    var voiceEndpoint = root.getAttribute('data-voice-endpoint') || '/api/assistant/voice';
    var messagesBox = document.getElementById('chat-messages');
    var loadingRow = document.getElementById('chat-loading-row');
    var statusNotice = document.getElementById('assistant-status-notice');
    var form = document.getElementById('assistant-chat-form');
    var input = document.getElementById('chat-question-input');
    var sendBtn = document.getElementById('send-question-btn');
    var clearBtn = document.getElementById('clear-chat-btn');
    var voiceBtn = document.getElementById('voice-btn');
    var speakToggle = document.getElementById('speak-replies-toggle');
    var voiceHint = document.getElementById('voice-support-hint');
    var engineLabel = document.getElementById('assistant-engine-label');

    var history = [];
    var context = {};
    var detail = 'detailed';
    var isPending = false;

    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    var recognition = null;
    var listening = false;
    var canSpeak = 'speechSynthesis' in window;

    function scrollToBottom() {
      if (messagesBox) messagesBox.scrollTop = messagesBox.scrollHeight;
    }

    function appendBubble(role, text, options) {
      if (!messagesBox) return null;
      var opts = options || {};
      var row = document.createElement('div');
      row.className = 'chat-bubble-row ' + (role === 'user' ? 'is-user' : 'is-assistant') + (opts.isError ? ' is-error' : '');

      var sender = document.createElement('span');
      sender.className = 'chat-sender';
      sender.textContent = role === 'user' ? (opts.viaVoice ? 'You (voice)' : 'You') : (opts.isError ? 'Service Notice' : 'Omi AI');

      var bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      String(text).split(/\n\n+/).forEach(function (para) {
        var p = document.createElement('p');
        p.textContent = para;
        bubble.appendChild(p);
      });

      var avatarSrc = root.getAttribute(role === 'user' ? 'data-avatar-src' : 'data-mascot-src');
      if (avatarSrc && !opts.isError) {
        var avatar = document.createElement('img');
        avatar.className = 'chat-avatar';
        avatar.src = avatarSrc;
        avatar.alt = '';
        avatar.width = 32;
        avatar.height = 32;
        row.classList.add('has-avatar');
        row.appendChild(avatar);
      }
      row.appendChild(sender);
      row.appendChild(bubble);

      if (opts.analysis && window.OmiResults) {
        var card = document.createElement('div');
        row.appendChild(card);
        try {
          window.OmiResults.renderChatCard(card, opts.analysis);
        } catch (e) {
          card.remove();
        }
      }

      messagesBox.appendChild(row);
      scrollToBottom();
      return row;
    }

    function setLoading(active) {
      isPending = active;
      if (loadingRow) loadingRow.classList.toggle('is-hidden', !active);
      if (sendBtn) sendBtn.disabled = active;
      if (input) input.disabled = active;
      if (voiceBtn) voiceBtn.disabled = active && !listening;
    }

    function showNotice(text) {
      if (!statusNotice) return;
      statusNotice.classList.remove('is-hidden');
      statusNotice.textContent = text;
    }

    function hideNotice() {
      if (statusNotice) statusNotice.classList.add('is-hidden');
    }

    function speak(text) {
      if (!canSpeak || !text) return;
      if (!(speakToggle && speakToggle.checked)) return;
      window.speechSynthesis.cancel();
      var utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-GB';
      utterance.rate = 1;
      window.speechSynthesis.speak(utterance);
    }

    function submitQuestion(questionText, viaVoice) {
      var trimmed = String(questionText || '').trim();
      if (!trimmed || isPending) return;

      hideNotice();
      appendBubble('user', trimmed, { viaVoice: viaVoice });

      if (input) {
        input.value = '';
        input.style.height = 'auto';
      }
      setLoading(true);

      var alpha = window.OmiUI ? window.OmiUI.getPreferences().alpha : '0.05';
      fetch(viaVoice ? voiceEndpoint : chatEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          question: trimmed,
          history: history.slice(-8),
          context: context,
          detail: detail,
          alpha: alpha,
          voice: !!viaVoice
        })
      })
        .then(function (res) {
          return res.text().then(function (raw) {
            var parsed = null;
            try { parsed = raw ? JSON.parse(raw) : null; } catch (e) {}
            if (!res.ok) throw new Error((parsed && parsed.error) || ('HTTP ' + res.status));
            if (!parsed) throw new Error('The server sent an unreadable response.');
            return parsed;
          });
        })
        .then(function (data) {
          var reply = data.answer || data.reply;
          if (!reply) throw new Error('The assistant response did not include an answer.');

          context = {
            params: data.params || {},
            awaiting: data.awaiting || null,
            has_result: !!data.has_result
          };
          history.push({ role: 'user', content: trimmed });
          history.push({ role: 'assistant', content: reply });

          appendBubble('assistant', reply, { analysis: data.analysis });
          if (engineLabel) {
            engineLabel.textContent = data.engine === 'gemini'
              ? 'Explanations worded by Gemini from the calculated NASA POWER results'
              : 'Explanations built by Omi from the calculated NASA POWER results';
          }
          if (viaVoice && speakToggle && !speakToggle.checked && canSpeak) speakToggle.checked = true;
          speak(data.speech || reply);
        })
        .catch(function (err) {
          showNotice('Omi could not answer right now (' + err.message + ').');
          appendBubble('assistant', 'Sorry, I could not complete that request: ' + err.message + '. No answer was made up — please try again.', { isError: true });
        })
        .finally(function () {
          setLoading(false);
          if (input && !viaVoice) input.focus();
        });
    }

    // --- Voice input -------------------------------------------------------
    function setListening(on) {
      listening = on;
      if (!voiceBtn) return;
      voiceBtn.classList.toggle('is-listening', on);
      voiceBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      voiceBtn.setAttribute('aria-label', on ? 'Stop listening' : 'Speak your question');
      if (input) input.placeholder = on ? 'Listening… speak now' : 'Ask Omi about the climate…';
    }

    if (SpeechRecognition && voiceBtn) {
      recognition = new SpeechRecognition();
      recognition.lang = 'en-NG';
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      var finalTranscript = '';

      recognition.onresult = function (event) {
        var interim = '';
        for (var i = event.resultIndex; i < event.results.length; i++) {
          var text = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalTranscript += text;
          else interim += text;
        }
        if (input) input.value = (finalTranscript + interim).trim();
      };
      recognition.onerror = function (event) {
        setListening(false);
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          showNotice('Microphone access was blocked. Allow microphone access in your browser to talk to Omi.');
        } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
          showNotice('Voice input stopped (' + event.error + '). You can type your question instead.');
        }
      };
      recognition.onend = function () {
        var wasListening = listening;
        setListening(false);
        var spoken = finalTranscript.trim() || (input ? input.value.trim() : '');
        finalTranscript = '';
        if (wasListening && spoken) submitQuestion(spoken, true);
      };

      voiceBtn.addEventListener('click', function () {
        if (listening) {
          recognition.stop();
          return;
        }
        if (canSpeak) window.speechSynthesis.cancel();
        hideNotice();
        finalTranscript = '';
        try {
          recognition.start();
          setListening(true);
        } catch (e) {
          setListening(false);
        }
      });
    } else if (voiceBtn) {
      voiceBtn.disabled = true;
      voiceBtn.title = 'Voice input is not supported in this browser';
      if (voiceHint) voiceHint.textContent = 'Voice input needs a browser with speech recognition (Chrome or Edge). You can still type.';
    }
    if (!canSpeak && speakToggle) {
      speakToggle.disabled = true;
    }

    // --- Detail level ----------------------------------------------------------
    document.querySelectorAll('[data-detail]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        detail = btn.getAttribute('data-detail');
        document.querySelectorAll('[data-detail]').forEach(function (b) {
          var on = b === btn;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      });
    });

    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (input) submitQuestion(input.value, false);
      });
    }

    if (input) {
      input.addEventListener('input', function () {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 140) + 'px';
      });
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          submitQuestion(input.value, false);
        }
      });
    }

    document.querySelectorAll('[data-suggested-question]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var q = btn.getAttribute('data-suggested-question');
        if (q) submitQuestion(q, false);
      });
    });

    if (clearBtn && messagesBox) {
      clearBtn.addEventListener('click', function () {
        history = [];
        context = {};
        hideNotice();
        if (canSpeak) window.speechSynthesis.cancel();
        messagesBox.innerHTML = '';
        appendBubble('assistant', 'Conversation cleared. What would you like to investigate?');
      });
    }

    // Arrived from the topbar search box: /assistant?q=...
    try {
      var q = new URLSearchParams(window.location.search).get('q');
      if (q && q.trim() && !sessionStorage.getItem('omi_pending_investigation')) {
        if (window.history && window.history.replaceState) window.history.replaceState(null, '', window.location.pathname);
        submitQuestion(q.trim().slice(0, 300), false);
      }
    } catch (e) {}

    // Arrived from the dashboard's "Ask Omi about this" button.
    try {
      var pending = sessionStorage.getItem('omi_pending_investigation');
      if (pending) {
        sessionStorage.removeItem('omi_pending_investigation');
        var data = JSON.parse(pending);
        context = { params: data.params || {}, has_result: true };
        if (data.detail) {
          var btn = document.querySelector('[data-detail="' + data.detail + '"]');
          if (btn) btn.click();
        }
        submitQuestion('Explain these results.', false);
      }
    } catch (e) {}
  });
})();
