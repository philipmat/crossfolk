import {handleWords} from '../server/handler.js';

export default {
  async fetch(request) {
    return handleWords(request, {env: process.env});
  }
};
