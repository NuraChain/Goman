// The render shape the suite already speaks, over `@azerothjs/testing`.
//
// The query layer (`getByRole`, `findByText`, `within`) is framework-agnostic and stays; only
// the mount changes. Binding the queries to the container here means the 16 component specs
// keep reading `screen.getByRole(...)` and `screen.container` exactly as they did.
import { cleanup, renderTest } from '@azerothjs/testing';
import { within, type BoundFunctions, type queries } from '@testing-library/dom';
import type { MountNode } from 'azerothjs';

export { cleanup };
export { fireEvent, screen, waitFor, within } from '@testing-library/dom';

export interface Screen extends BoundFunctions<typeof queries> {
    container: HTMLElement;
    unmount: () => void;
}

export function render(component: () => MountNode): Screen
{
    const { container, unmount } = renderTest(component);
    return Object.assign(within(container), { container, unmount });
}

/**
 * There is no batching boundary to enter: an azeroth write applies synchronously and its
 * effects flush before the call returns. `act` stays as a name so the specs that reached for
 * it still read the same, and an async body is simply awaited.
 */
export async function act(body: () => void | Promise<void>): Promise<void>
{
    await body();
}
