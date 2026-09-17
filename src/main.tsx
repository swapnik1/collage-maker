import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// No StrictMode: its double-invocation in development would decode and close
// ImageBitmaps twice, which makes photo loading harder to reason about.
createRoot(document.getElementById('root')!).render(<App />);
