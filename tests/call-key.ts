// How a recorded process call is found again: the command without its path,
// the psql variables, and a hash of the SQL on stdin. Shared by
// dev/engine-e2e.ts, which records, and the pane test, which replays.

export function callKey(argv: readonly string[], stdin: string | undefined): string {
  const vars = argv.filter(arg => arg.includes('=') && !arg.startsWith('ON_ERROR') && !arg.startsWith('PG'))
  const sql = stdin === undefined ? '' : ` #${hash(stdin)}`
  const tool = (argv[0] ?? '').split('/').pop() ?? ''
  if (tool === 'docker' && argv[1] === 'exec') {
    const container = argv[argv.indexOf('psql') - 1] ?? ''

    return `docker exec ${container} ${vars.join(' ')}${sql}`
  }
  if (tool === 'docker') return `docker ${argv.slice(1).join(' ')}`

  return `${tool} ${vars.join(' ')}${sql}`
}

function hash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0

  return h.toString(36)
}
