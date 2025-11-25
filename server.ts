const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    
    // Serve index.html for root path
    if (url.pathname === '/') {
      const file = Bun.file('./index.html');
      return new Response(file, {
        headers: {
          'Content-Type': 'text/html',
        },
      });
    }
    
    // Serve TypeScript files from src/
    if (url.pathname.startsWith('/src/') && url.pathname.endsWith('.ts')) {
      const filePath = '.' + url.pathname;
      const file = Bun.file(filePath);
      
      if (await file.exists()) {
        // Transpile TypeScript to JavaScript on the fly
        const text = await file.text();
        const transpiled = await Bun.build({
          entrypoints: [filePath],
          target: 'browser',
        });
        
        if (transpiled.outputs.length > 0) {
          const output = transpiled.outputs[0];
          return new Response(await output.text(), {
            headers: {
              'Content-Type': 'application/javascript',
            },
          });
        }
      }
    }
    
    // Serve static files from node_modules (for three.js)
    if (url.pathname.startsWith('/node_modules/')) {
      const filePath = '.' + url.pathname;
      const file = Bun.file(filePath);
      
      if (await file.exists()) {
        const contentType = url.pathname.endsWith('.js') 
          ? 'application/javascript' 
          : 'text/plain';
        
        return new Response(file, {
          headers: {
            'Content-Type': contentType,
          },
        });
      }
    }
    
    return new Response('Not Found', { status: 404 });
  },
});

console.log(`🚀 Magnetic Builder running at http://localhost:${server.port}`);
console.log(`   Open http://localhost:${server.port} in your browser`);
