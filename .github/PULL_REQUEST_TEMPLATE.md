## Summary

<!-- What does this PR do? Link the issue it closes. -->

Closes #

## Changes

<!-- List the files changed and why. -->

- 

## Testing

<!-- How did you verify this works? What should reviewers test? -->

- [ ] `bun test` passes
- [ ] `bun run lint` passes
- [ ] `bun run build` succeeds

## Security checklist

<!-- For any change that touches vault backends, hook scripts, injection, or scrubbing: -->

- [ ] Secret values are never returned in tool output or error messages
- [ ] Secret values are not written to disk within the project directory
- [ ] Secret values are not exported to the process environment beyond a single subprocess lifetime
- [ ] Output scrubbing is not bypassed by this change
- [ ] N/A — this change does not touch security-sensitive code

## Notes for reviewers

<!-- Anything you want reviewers to pay special attention to? -->
