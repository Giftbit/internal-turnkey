# internal-turnkey
Supports turnkey widgets

## Testing

Deploy to dev: `./dev.sh deploy`. 

In `giftbit-apitests`, run `npx mocha "src/v1/turnkey/**/*.ts" --env dev --timeout 30000 --require ts-node/register`. 

You can `.only` specific tests for more targeted results, just make sure you also `.only` the set in `src/v1/registration.ts` so tests that require credentials will have them. 

## Deploy

