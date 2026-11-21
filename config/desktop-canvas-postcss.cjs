/** Replay existing desktop breakpoint utilities only inside small-screen canvases.
 * Original rules remain untouched; portal chrome and public pages are outside the scope.
 */
function desktopCanvas() {
  return {
    postcssPlugin: 'invoice-bizfolio-desktop-canvas',
    OnceExit(root, { postcss }) {
      const output = postcss.atRule({ name: 'media', params: 'screen and (width < 80rem)' });
      root.walkRules((rule) => {
        if (!/(?:sm|md|lg|xl)\\:/.test(rule.selector)) return;
        const ancestors = [];
        let matched = false;
        for (let parent = rule.parent; parent && parent !== root; parent = parent.parent) {
          if (parent.type !== 'atrule') continue;
          if (parent.name === 'layer') continue;
          if (parent.name === 'media') {
            // Dev builds print "(width >= 64rem)"; production (minified) prints "(min-width:64rem)". Accept both.
            const width = /^\((?:width\s*>=|min-width\s*:)\s*(\d+(?:\.\d+)?)rem\)$/.exec(parent.params);
            if (width) {
              if (Number(width[1]) > 80) return;
              matched = true;
              continue;
            }
            if (/width|print/.test(parent.params)) return;
          }
          ancestors.unshift(parent);
        }
        if (!matched) return;
        let clone = rule.clone();
        clone.selector = rule.selectors.map((selector) => `:where([data-desktop-canvas]) ${selector}`).join(', ');
        for (const ancestor of ancestors.reverse()) {
          const wrapper = ancestor.clone({ nodes: [] });
          wrapper.append(clone);
          clone = wrapper;
        }
        output.append(clone);
      });
      if (output.nodes?.length) {
        const layer = postcss.atRule({ name: 'layer', params: 'utilities' });
        layer.append(output);
        root.append(layer);
      }
    },
  };
}
desktopCanvas.postcss = true;

module.exports = desktopCanvas;
