A tool that provides both web-based and command line methods to get GitHub commit summaries.

The web interface:
- Enter repository owner and name
- Optionally provide a GitHub token for private repos or higher rate limits
- Automatically categorizes commits into Features, Fixes, and Other
- Shows author summary

The command line methods shown:
1. Basic format with commit message and body
2. Detailed format with author and date
3. Grouped by author using awk

If you need to customize the categorization logic or date range, the key parts to modify are:
- `twoWeeksAgo.setDate()` for the time period
- The regex patterns in `formatCommitSummary()` for categorization
- The `--since` parameter in git commands

For rate limits, GitHub allows 60 requests/hour without auth, 5000 with token.
