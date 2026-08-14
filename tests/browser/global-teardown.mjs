import { stopPreviewServer } from './global-setup.mjs';

export default function globalTeardown() {
	stopPreviewServer();
}
