import type { Observation } from '../../src/models/observation';

export function loginObservation(): Observation {
  return {
    observationId: 1,
    url: 'http://localhost:8080/login',
    frames: [{ name: null, url: 'http://localhost:8080/login' }],
    nodes: [
      { role: 'text', name: 'Please Sign On', frame: null },
      { ref: 'e1', role: 'cell', name: 'User ID:', frame: null },
      { ref: 'e2', role: 'textbox', name: '', label: 'User ID', value: '', frame: null },
      { ref: 'e3', role: 'cell', name: 'Password:', frame: null },
      { ref: 'e4', role: 'textbox', name: '', label: 'Password', value: '', frame: null },
      { ref: 'e5', role: 'button', name: 'Sign On', frame: null },
    ],
    dialog: null,
  };
}

export function emptyObservation(): Observation {
  return {
    observationId: 0,
    url: 'about:blank',
    frames: [{ name: null, url: 'about:blank' }],
    nodes: [],
    dialog: null,
  };
}
