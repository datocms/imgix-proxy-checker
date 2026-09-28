import { handleInspectRequest } from '../lib/inspect.js';

export const GET = (request: Request) => handleInspectRequest(request);
