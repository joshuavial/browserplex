import { afterEach, describe, expect, it } from 'vitest';
import * as actions from '../core/actions.js';
import { sessionManager } from '../core/sessions.js';

describe('framework form interactions', () => {
  afterEach(async () => {
    await sessionManager.destroyAll();
  });

  async function createPage() {
    const session = await sessionManager.create('forms-test', 'chromium');
    return session.page;
  }

  it('dismisses transient overlays with Escape before retrying a click', async () => {
    const page = await createPage();
    await page.setContent(`
      <button id="target">Submit</button>
      <div id="overlay" style="position:fixed; inset:0; background:rgba(0,0,0,0.1)"></div>
      <script>
        window.clicked = false;
        document.querySelector('#target').addEventListener('click', () => { window.clicked = true; });
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') document.querySelector('#overlay')?.remove();
        });
      </script>
    `);

    await actions.browserClick({ session: 'forms-test', selector: '#target', timeout: 300 });

    await expect(page.evaluate(() => (window as unknown as { clicked: boolean }).clicked)).resolves.toBe(true);
  });

  it('sets controlled input state through native value plus input/change events', async () => {
    const page = await createPage();
    await page.setContent(`
      <input id="name" />
      <output id="state"></output>
      <script>
        const input = document.querySelector('#name');
        input.addEventListener('input', (event) => {
          document.querySelector('#state').textContent = event.target.value;
        });
      </script>
    `);

    await actions.browserType({ session: 'forms-test', selector: '#name', text: 'Ada Lovelace' });

    await expect(page.textContent('#state')).resolves.toBe('Ada Lovelace');
    await expect(page.inputValue('#name')).resolves.toBe('Ada Lovelace');
  });

  it('falls back to requestSubmit when Enter does not submit a framework form', async () => {
    const page = await createPage();
    await page.setContent(`
      <form id="profile">
        <input id="name" name="name" />
        <button type="submit">Save</button>
      </form>
      <output id="submitted"></output>
      <script>
        const input = document.querySelector('#name');
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') event.preventDefault();
        });
        document.querySelector('#profile').addEventListener('submit', (event) => {
          event.preventDefault();
          document.querySelector('#submitted').textContent = new FormData(event.target).get('name');
        });
      </script>
    `);

    await actions.browserType({ session: 'forms-test', selector: '#name', text: 'Grace Hopper', submit: true });

    await expect(page.textContent('#submitted')).resolves.toBe('Grace Hopper');
  });

  it('uses the same framework-safe setter for fill form', async () => {
    const page = await createPage();
    await page.setContent(`
      <input id="first" />
      <input id="last" />
      <output id="state"></output>
      <script>
        const values = {};
        for (const input of document.querySelectorAll('input')) {
          input.addEventListener('input', (event) => {
            values[event.target.id] = event.target.value;
            document.querySelector('#state').textContent = JSON.stringify(values);
          });
        }
      </script>
    `);

    await actions.browserFillForm({
      session: 'forms-test',
      fields: [
        { selector: '#first', value: 'Katherine' },
        { selector: '#last', value: 'Johnson' },
      ],
    });

    await expect(page.textContent('#state')).resolves.toBe('{"first":"Katherine","last":"Johnson"}');
  });
});
