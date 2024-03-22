Bun.serve({
	port: process.env.PORT || 3000,
	fetch: (_, __) => new Response('Hello World!'),
})
