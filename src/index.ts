/**
 * Process entry point. Bootstraps the action when the bundled
 * `dist/index.js` runs.
 */

import {handleError, main} from './main.js'

process.on('unhandledRejection', handleError)
main().catch(handleError) // eslint-disable-line github/no-then
