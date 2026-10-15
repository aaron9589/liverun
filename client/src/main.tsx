import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { MobileRoot } from './components/MobileRoot';
import { GuardPanel } from './components/guard/GuardPanel';
import { ModePicker } from './components/ModePicker';
import { loadSavedMode, resolveMode } from './lib/mode';
import './index.css';

const isMobileUA = /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
const { view, replacePath } = resolveMode({
  pathname: window.location.pathname,
  search: window.location.search,
  savedMode: loadSavedMode(),
  isMobileUA,
});
if (replacePath) window.history.replaceState(null, '', replacePath);

const root =
  view === 'guard' ? <GuardPanel /> :
  view === 'crew' ? <MobileRoot /> :
  view === 'choose' ? <ModePicker /> :
  <App />;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{root}</React.StrictMode>
);
