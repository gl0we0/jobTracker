(function() {
  function setPanelState(panel, open) {
    const toggle = panel.querySelector('[data-curtain-panel-toggle]');
    panel.classList.toggle('is-collapsed', !open);
    if (toggle) {
      const label = toggle.querySelector('.curtain-side-tab__label');
      const statusText = open ? 'Hide tools' : 'Show tools';
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', statusText);
      toggle.setAttribute('title', statusText);
      if (label) {
        label.textContent = statusText;
      }
    }
  }

  function setActiveTool(panel, target) {
    if (!panel || !target) {
      return;
    }

    const triggers = panel.querySelectorAll('[data-tool-frame-trigger]');
    const frames = panel.querySelectorAll('[data-tool-frame]');

    triggers.forEach(trigger => {
      const isActive = trigger.dataset.toolTarget === target;
      trigger.classList.toggle('is-active', isActive);
      trigger.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    frames.forEach(frame => {
      const isActive = frame.dataset.toolFrame === target;
      if (isActive && !frame.getAttribute('src') && frame.dataset.src) {
        frame.setAttribute('src', frame.dataset.src);
      }
      frame.classList.toggle('is-active', isActive);
      frame.hidden = !isActive;
    });
  }

  function initializeCurtainPanels(root) {
    const scope = root || document;
    const panels = scope.querySelectorAll('.curtain-side-panel');

    panels.forEach(panel => {
      if (panel.dataset.curtainPanelBound === 'true') {
        return;
      }
      panel.dataset.curtainPanelBound = 'true';

      const toggle = panel.querySelector('[data-curtain-panel-toggle]');
      if (toggle) {
        toggle.addEventListener('click', function() {
          const isCollapsed = panel.classList.contains('is-collapsed');
          setPanelState(panel, isCollapsed);
        });
      }

      const toolTriggers = panel.querySelectorAll('[data-tool-frame-trigger]');
      toolTriggers.forEach(trigger => {
        trigger.addEventListener('click', function() {
          setActiveTool(panel, trigger.dataset.toolTarget);
        });
      });

      setPanelState(panel, false);
      const defaultTrigger = panel.querySelector('[data-tool-frame-trigger].is-active') || toolTriggers[0];
      if (defaultTrigger) {
        setActiveTool(panel, defaultTrigger.dataset.toolTarget);
      }
    });
  }

  window.initializeCurtainPanels = initializeCurtainPanels;

  document.addEventListener('DOMContentLoaded', function() {
    initializeCurtainPanels(document);
  });
})();
