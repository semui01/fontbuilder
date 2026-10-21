import './styles.css';
import { byId } from './ui/dom';
import { setupDrawPanel } from './ui/drawPanel';
import { FontController } from './ui/fontController';
import { setupPhotoPanel } from './ui/photoPanel';
import { setupReview } from './ui/review';
import { AppState } from './ui/state';
import { setupTabs } from './ui/tabs';
import { setupTemplatePanel } from './ui/templatePanel';
import { setupTuneAndUse } from './ui/usePanel';

const state = new AppState();
state.load();

const fonts = new FontController(state, byId('build-status'));
const selectTab = setupTabs(document.querySelector('.tabs') as HTMLElement);

setupTemplatePanel(state);
setupPhotoPanel(state);
const draw = setupDrawPanel(state);

const renderReview = setupReview(state, fonts, (char) => {
  selectTab('tab-draw');
  draw.select(char);
  byId('collect').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
const refreshUse = setupTuneAndUse(state, fonts);

state.onGlyphs(() => {
  renderReview();
  fonts.schedule();
});
fonts.onBuilt(() => {
  renderReview();
  refreshUse();
});

renderReview();
refreshUse();
fonts.schedule(0);
