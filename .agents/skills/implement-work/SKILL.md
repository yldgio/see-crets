---
name: implement-work
description: End-to-end implementation workflow. Use when user wants to implement a feature, fix a bug, or make changes and have everything validated and committed to the codebase. This skill covers the entire implementation process from understanding requirements, exploring the codebase, writing code, testing, and committing changes.
---

# Implement Work
End-to-end implementation workflow from exploration to commit.

## Input: User request to implement a feature, fix a bug, or make changes to the codebase.
user requests implementation of a feature, bug fix, or code change pointing to a specific github issue, user story, or requirement file.

## Workflow
1. Explore requirements and codebase using subagent calls as needed to understand the problem and current state.
2. Plan implementation, breaking it down into manageable steps or tasks. Create a to-do list if helpful.
3. Verify git status is clean before starting implementation. If not, ask user how to proceed (stash, commit, discard changes).
3a. Create a new branch for the implementation work following the naming convention: `feature/<short-description>` or `bugfix/<short-description>`.
4. Write tests in Test-Driven Development (TDD) style if applicable and not trivial. Otherwise, write code directly but ensure to cover edge cases.
5. Implement code to pass tests
6. Continue iterating on implementation and tests until all requirements are met and tests pass
6a. stage changes
7. Run parallel subagents to validate implementation against acceptance criteria, adverse scenarios, code quality (readability, maintainability, security), and performance benchmarks as applicable. 
8. Iterate on code and tests based on feedback until validation is successful.
9. Commit changes with conventional commits
10. Push branch to remote and create a pull request for review