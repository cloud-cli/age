export async function ShellExec(/*string*/ command) {
  '## Runs a command in a subshell and returns the stdout/stderr.##';
  console.log('ShellExec', command);
  const sh = this.getShell();
  return sh.exec(command);
}
