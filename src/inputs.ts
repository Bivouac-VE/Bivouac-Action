import * as core from '@actions/core';
import { markerFor } from './state';
import type { Inputs } from './types';

export function readInputs(): Inputs {
  const token = core.getInput('github-token', { required: true });
  const markerRaw = core.getInput('comment-marker');
  return {
    githubToken: token,
    commentMarker: markerFor(markerRaw ?? ''),
  };
}
