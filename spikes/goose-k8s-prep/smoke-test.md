Title: [smoke-test] Implement FizzBuzz variant with a twist

## Goal
End-to-end pipeline validation: webhook → pod → agent implements → PR opened.
Not testing code complexity — testing that the agent can read a spec, write
working code + a test, and open a clean PR.

## Task
Add a function `classify(n: int) -> str` that:

- Returns `"Fizz"` if `n` is divisible by 3
- Returns `"Buzz"` if `n` is divisible by 5
- Returns `"FizzBuzz"` if divisible by both
- Returns `"Prime"` if none of the above apply **and** `n` is prime
- Otherwise returns the number as a string

Precedence matters: Fizz/Buzz rules are checked before primality.

## Acceptance criteria
- [ ] Function lives in `src/classify.py` (or language-appropriate equivalent — pick based on repo conventions)
- [ ] Includes at least 5 unit tests covering each branch, including one edge case (e.g. `n = 1`, `n = 0`, or a negative number — agent's choice, but must justify it in a code comment or PR description)
- [ ] Tests pass in CI
- [ ] PR description states the approach taken for primality check and its time complexity

## Out of scope
- Performance optimization beyond a naive primality check
- Handling non-integer input
- Any refactor of surrounding code

## Notes for agent
Keep the diff small. This is a pipeline smoke test — a correct, minimal, well-tested implementation is the win condition, not extra scope.
