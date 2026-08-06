// Vercel root entry — imports express to satisfy cached framework detection
// Actual routing: /api/* → api/*.js, / → public/index.html
import 'express';

export default {
  fetch(request) {
    return new Response(null, { status: 200 });
  }
};
