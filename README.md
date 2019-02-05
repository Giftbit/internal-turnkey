# internal-turnkey
Supports turnkey widgets

## Testing

Deploy to dev: `./dev.sh deploy`. 

In `giftbit-apitests`, run `npx mocha --timeout 30000 --require ts-node/register src/v1/registration.ts src/v1/turnkey/**/*.ts --env dev` to run only turnkey-related tests. 

You can `.only` specific tests for more targeted results, just make sure you also `.only` the set in `src/v1/registration.ts` so tests that require credentials will have them. 

## Deploy

