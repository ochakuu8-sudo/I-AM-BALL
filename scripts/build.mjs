import {fileURLToPath} from 'node:url';

// On Windows, the beta CLI's immediate successful exit after prerendering can
// trigger UV_HANDLE_CLOSING in a native dependency. Drain the event loop on
// success; preserve the CLI's nonzero exit status for every build failure.
if(process.platform==='win32'){
 const exit=process.exit.bind(process);
 process.exit=(code=0)=>{if(Number(code)!==0)exit(code);process.exitCode=0;};
}
const cli=new URL('./cli.js',import.meta.resolve('vinext'));
process.argv=[process.execPath,fileURLToPath(cli),'build',...process.argv.slice(2)];
await import(cli.href);
