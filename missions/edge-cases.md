Test how this {{surface}} behaves when things go wrong or are unusual, as an agent that makes mistakes would experience it. Work with tiny data and avoid costly calls (at most three of any paid operation).

Probe, for example: ids that do not exist or are malformed; missing or wrongly typed parameters; empty and very long strings; acting on something that has nothing to act on; an id that belongs to nobody; pagination (limits, cursors, the end of a list); a slow operation and what you get back while it runs; deleting the same thing twice; repeating a costly call with the same idempotency key if one exists; an input that points to something that does not exist or is not public.

For each probe, judge the error: is it clear, does it say what to do next, is the type or code useful to a program, is the exit code or status right, is anything leaked that should not be?
Clean up what you created (only what you created).
