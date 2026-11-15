import type { Metadata } from 'next';
import { PrintStudio } from './print-studio';
// Shares Negative Studio's dark theme.
import '../negative-studio/studio.css';

export const metadata: Metadata = { title: 'Cyanotype Print Studio' };

// Sign-in is checked by the proxy, like every tool. Photos never leave the browser, so there's nothing to load here.
export default function PrintStudioPage() {
  return <PrintStudio />;
}
