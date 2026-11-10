import assert from 'node:assert/strict';

function requiredSetting(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} to run the dialog accessibility browser test.`);
  return value;
}

/**
 * Verify the shared Modal's dialog role, accessible name, and optional
 * description using the browser's accessible-role queries.
 */
export async function runDialogAccessibilityBrowserTest({ newBrowserContext }) {
  if (typeof newBrowserContext !== 'function') {
    throw new TypeError('Pass the newBrowserContext helper from the browser runner.');
  }

  const baseURL = requiredSetting('ANIF_BASE_URL');
  const context = await newBrowserContext({});
  const page = await context.newPage();

  try {
    await page.goto(baseURL);

    async function renderDialog(title, description) {
      await page.evaluate(({ title, description }) => {
        return import('/tests/browser/dialog-accessibility-harness.tsx')
          .then(({ mountDialog }) => mountDialog(title, description));
      }, { title, description });
      return page.getByRole('dialog', { name: title });
    }

    const titleWithDescription = 'Dialogue avec description';
    const description = 'Description annoncée une seule fois.';
    const describedDialog = await renderDialog(titleWithDescription, description);
    await describedDialog.waitFor({ state: 'visible' });
    const descriptionMatchedDialog = page.getByRole('dialog', {
      name: titleWithDescription,
      description,
    });
    await descriptionMatchedDialog.waitFor({ state: 'visible' });

    const describedAttributes = await describedDialog.evaluate((dialog) => {
      const titleId = dialog.getAttribute('aria-labelledby');
      const descriptionIds = dialog.getAttribute('aria-describedby')?.trim().split(/\s+/) ?? [];
      return {
        role: dialog.getAttribute('role'),
        titleId,
        titleTexts: titleId ? document.getElementById(titleId)?.textContent?.trim() : undefined,
        descriptionIds,
        descriptionTexts: descriptionIds.map((id) => document.getElementById(id)?.textContent?.trim()),
      };
    });
    assert.equal(describedAttributes.role, 'dialog');
    assert.ok(describedAttributes.titleId, 'The dialog must reference its title.');
    assert.equal(describedAttributes.titleTexts, titleWithDescription);
    assert.equal(describedAttributes.descriptionIds.length, 1,
      'The dialog must reference the description exactly once.');
    assert.deepEqual(describedAttributes.descriptionTexts, [description],
      'The accessible description must contain the supplied text once.');

    const titleWithoutDescription = 'Dialogue sans description';
    const plainDialog = await renderDialog(titleWithoutDescription, undefined);
    await plainDialog.waitFor({ state: 'visible' });
    await page.getByRole('dialog', { name: titleWithoutDescription, description: '' })
      .waitFor({ state: 'visible' });
    const plainAttributes = await plainDialog.evaluate((dialog) => ({
      role: dialog.getAttribute('role'),
      titleId: dialog.getAttribute('aria-labelledby'),
      titleTexts: dialog.getAttribute('aria-labelledby')
        ? document.getElementById(dialog.getAttribute('aria-labelledby'))?.textContent?.trim()
        : undefined,
      describedBy: dialog.getAttribute('aria-describedby'),
    }));
    assert.equal(plainAttributes.role, 'dialog');
    assert.ok(plainAttributes.titleId, 'The dialog must reference its title.');
    assert.equal(plainAttributes.titleTexts, titleWithoutDescription);
    assert.equal(plainAttributes.describedBy, null,
      'A missing description must not cause the title to be announced a second time.');

    console.log('PASS: dialogs expose their title as the accessible name and include only an explicitly supplied description.');
  } finally {
    await context.close();
  }
}
