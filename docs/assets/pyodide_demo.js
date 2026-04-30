/* SPDX-License-Identifier: Apache-2.0 */
/* eslint-env browser */
/* eslint-disable no-undef */
const CDN_BASE = 'https://cdn.jsdelivr.net/pyodide/v0.28.0/full/';

export async function loadRuntime() {
  const localBase = '../assets/pyodide/';
  const localScript = `${localBase}pyodide.js`;
  try {
    const resp = await fetch(localScript, {method: 'HEAD'});
    if (resp.ok) {
      try {
        const mod = await import(localScript);
        return await mod.loadPyodide({indexURL: localBase});
      } catch (err) {
        console.warn('Local Pyodide failed:', err);
      }
    } else {
      console.warn('Local Pyodide missing:', resp.status);
    }
  } catch (err) {
    console.warn('Local Pyodide not accessible:', err);
  }
  const mod = await import(`${CDN_BASE}pyodide.mjs`);
  return await mod.loadPyodide({indexURL: CDN_BASE});
}

export function setupPyodideDemo(chart, logEl, experiments, onExperimentRendered) {
  const knownExperiments = Array.isArray(experiments) && experiments.length > 0
    ? experiments
    : [{id: 'default', payload: {steps: [], values: [], logs: []}}];

  function showMessage(msg) {
    if (logEl) {
      logEl.textContent += `${msg}\n`;
    }
  }

  function render(payload, activeId) {
    const steps = payload?.steps || [];
    const values = payload?.values || [];
    const logs = payload?.logs || [];
    chart.data.labels = [];
    chart.data.datasets[0].data = [];
    if (logEl) logEl.textContent = '';
    steps.forEach((s, idx) => {
      chart.data.labels.push(s);
      chart.data.datasets[0].data.push(values[idx]);
      chart.update();
      if (logEl && logs[idx]) logEl.textContent += logs[idx] + '\n';
    });
    onExperimentRendered?.(activeId);
  }

  const defaultExperiment = knownExperiments[0];
  render(defaultExperiment.payload, defaultExperiment.id);

  window.addEventListener('experiment-change', (event) => {
    const activeId = event.detail?.id;
    const selected = knownExperiments.find((entry) => entry.id === activeId);
    if (selected) {
      render(selected.payload, selected.id);
    }
  });

  let pyodide;
  const offlineBtn = document.getElementById('offline-mode');
  const onlineBtn = document.getElementById('online-mode');

  async function runOffline() {
    if (!pyodide) {
      showMessage('Loading Python runtime...');
      pyodide = await loadRuntime();
    }
    const code = `import json, random
steps = list(range(1, 11))
values = [random.random() for _ in steps]
logs = [f"offline step {i}" for i in steps]
json.dumps({"steps": steps, "values": values, "logs": logs})`;
    const result = await pyodide.runPythonAsync(code);
    render(JSON.parse(result), 'offline-runtime');
    showMessage('Offline simulation complete.');
  }

  offlineBtn?.addEventListener('click', runOffline);

  onlineBtn?.addEventListener('click', async () => {
    const key = window.prompt('Enter OpenAI API key');
    if (!key) return;
    showMessage('Querying OpenAI API...');
    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [{
            role: 'user',
            content: 'Return JSON {"steps": [1,2,...,10], "values": [10 floats], "logs": [10 strings]}'
          }],
        }),
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content || '{}';
      let parsed = {};
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        console.error('OpenAI response parse error', e);
      }
      render(parsed, 'openai-response');
      showMessage('OpenAI response received.');
    } catch (err) {
      console.error('OpenAI request failed', err);
      showMessage('OpenAI request failed. Falling back to offline mode.');
      await runOffline();
    }
  });
}
