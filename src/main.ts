import './ui/styles.css';
import { createApp } from './ui/App';

const root = document.getElementById('app');
if (!root) {
  throw new Error('#app root element not found');
}
createApp(root);
