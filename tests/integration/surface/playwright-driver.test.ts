import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixtureSessionProvider } from '../../../src/diplomat/session/fixture-login';
import { SurfaceError } from '../../../src/diplomat/surface/errors';
import { createPlaywrightDriver } from '../../../src/diplomat/surface/playwright-driver';
import type { SurfaceDriver } from '../../../src/diplomat/surface/port';
import type { Action } from '../../../src/models/action';
import type { Observation, ObservationNode } from '../../../src/models/observation';
import { startFixture, type FixtureHandle } from '../../support/fixture';

const PASSWORD = 'training';

function click(target: string): Action {
  return { verb: 'click', target, argument: null, rationale: 'test' };
}

function fill(target: string, argument: string): Action {
  return { verb: 'fill', target, argument, rationale: 'test' };
}

function memberIdBox(observation: Observation): ObservationNode | undefined {
  return observation.nodes.find(
    (node) => node.frame === 'content' && node.role === 'textbox' && node.label === 'Member ID',
  );
}

function searchButton(observation: Observation): ObservationNode | undefined {
  return observation.nodes.find((node) => node.frame === 'content' && node.role === 'button' && node.name === 'Search');
}

describe('Playwright surface driver against the fixture', { timeout: 30_000 }, () => {
  let fixture: FixtureHandle | undefined;
  let driver: SurfaceDriver | undefined;

  beforeAll(async () => {
    fixture = await startFixture();
    const session = await createFixtureSessionProvider({ username: 'operator', password: PASSWORD }).establish(
      `${fixture.baseUrl}/`,
    );
    driver = createPlaywrightDriver();
    await driver.open(`${fixture.baseUrl}/`, session);
  }, 30_000);

  afterAll(async () => {
    await driver?.close();
    await fixture?.stop();
  });

  function surface(): SurfaceDriver {
    if (driver === undefined) throw new Error('driver not started');
    return driver;
  }

  it('observes the signed-in shell, navigates the content frame and fills a field', async () => {
    const shell = await surface().observe();

    expect(shell.frames.map((frame) => frame.name)).toEqual([null, 'content']);
    expect(JSON.stringify(shell)).not.toContain(PASSWORD);
    const lookup = shell.nodes.find((node) => node.frame === null && node.role === 'link' && node.name === 'Member Lookup');
    expect(lookup?.ref).toMatch(/^e\d+$/);

    await surface().perform(click(lookup?.ref ?? ''));

    await expect
      .poll(async () => {
        const observation = await surface().observe();
        return [memberIdBox(observation)?.ref, searchButton(observation)?.ref];
      })
      .toEqual([expect.stringMatching(/^e\d+$/), expect.stringMatching(/^e\d+$/)]);

    const lookupPage = await surface().observe();
    const textbox = memberIdBox(lookupPage);
    expect(textbox?.name).toBe('');

    await expect(surface().perform(click('e999'))).rejects.toMatchObject({ name: 'SurfaceError', code: 'unknown_ref' });

    await surface().perform(fill(textbox?.ref ?? '', '10001'));
    const filled = await surface().observe();
    expect(memberIdBox(filled)?.value).toBe('10001');
  });

  it('rejects verbs that are not page actions without touching the page', async () => {
    await surface().observe();

    await expect(surface().perform({ verb: 'finish', target: null, argument: null, rationale: 'test' })).rejects.toBeInstanceOf(
      SurfaceError,
    );
  });

  it('refuses to observe before open', async () => {
    await expect(createPlaywrightDriver().observe()).rejects.toMatchObject({ code: 'not_open' });
  });
});
