/**
 * Tracks whether the user has typed into the page since it loaded, so
 * auto-refresh can avoid throwing that input away. Only real (trusted)
 * keyboard input counts; values filled in by the page's own scripts don't.
 */
export class UserInputTracker {
	private hasTyped = false;

	start(): void {
		document.addEventListener(
			'input',
			(event) => {
				if (event.isTrusted && this.isEditable(event.target)) {
					this.hasTyped = true;
				}
			},
			true
		);

		// A submitted form has been sent, so its input is no longer at risk.
		document.addEventListener('submit', () => (this.hasTyped = false), true);
	}

	hasUnsavedInput(): boolean {
		if (this.hasTyped) return true;

		// Someone is typing in a focused field right now.
		return document.hasFocus() && this.isEditable(document.activeElement);
	}

	private isEditable(target: EventTarget | Element | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		if (target.isContentEditable) return true;
		if (target instanceof HTMLTextAreaElement) return !target.readOnly && !target.disabled;
		if (target instanceof HTMLInputElement) {
			const nonText = [
				'button',
				'checkbox',
				'color',
				'file',
				'hidden',
				'image',
				'radio',
				'range',
				'reset',
				'submit',
			];
			return !nonText.includes(target.type) && !target.readOnly && !target.disabled;
		}

		return false;
	}
}
