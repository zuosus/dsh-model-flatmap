/**
 * Host half of the flat model picker bundle.
 *
 * The plugin is browser-only: it replaces the composer's `conversation.input.model`
 * seat with a flat panel rendered in the Web GUI, and reads the Session's model
 * directory, projections and `session.selectModel` through public Client APIs.
 * The Host therefore contributes no service, tool or event.
 */
export const name = 'dsh-model-flatmap'
export const inject = []

export function apply() {}