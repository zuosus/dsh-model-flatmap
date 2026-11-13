/**
 * Host half of the flat model picker bundle.
 *
 * The plugin is client-side and runs in both the Web GUI and the Desktop app: it
 * replaces the composer's `conversation.input.model` seat with a flat panel rendered
 * in the client UI, and reads the Session's model directory, projections and
 * `session.selectModel` through public Client APIs.
 * The Host therefore contributes no service, tool or event.
 */
export const name = 'dsh-model-flatmap'
export const inject = []

export function apply() {}