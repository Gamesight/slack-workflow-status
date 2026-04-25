import {main, handleError} from './main'

process.on('unhandledRejection', handleError)
main().catch(handleError) // eslint-disable-line github/no-then
