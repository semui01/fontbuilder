/** Accessible tabs: click or arrow keys switch panels. Returns a function to select a tab by id. */
export function setupTabs(tablist: HTMLElement): (tabId: string) => void {
  const tabs = [...tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const select = (tab: HTMLButtonElement, focus = false): void => {
    for (const t of tabs) {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls') ?? '');
      if (panel) panel.hidden = !selected;
    }
    if (focus) tab.focus();
  };
  for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(tab);
      if (e.key === 'ArrowRight') select(tabs[(i + 1) % tabs.length], true);
      else if (e.key === 'ArrowLeft') select(tabs[(i - 1 + tabs.length) % tabs.length], true);
      else return;
      e.preventDefault();
    });
  }
  return (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab) select(tab);
  };
}
