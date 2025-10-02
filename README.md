# Project Pluto - Fullstack Coding Assessment

## Purpose
Welcome! This assessment is a practical preview of life as a Fullstack Engineer at Project Pluto. You'll use our standard tech stack to build a simplified data processing pipeline, mirroring the kinds of challenges our team solves every day. This is a great opportunity for you to showcase your engineering skills on a project that’s representative of our work.

## Task
Your task is to build a full-stack web application that streams real-time cryptocurrency prices from https://tradingview.com. The application will consist of a Node.js backend and a Next.js frontend.

A demonstration of the expected functionality is available in the video file `demo.gif` file in this repository.

## Tech Stack
You are required to use the following technologies:
*   TypeScript
*   Next.js
*   Node.js
    *   `tsx` for TypeScript execution
*   `pnpm` for package management (do not use `npm`)
*   ConnectRPC for communication between the frontend and backend
*   Playwright to stream price data from TradingView via the Node.js server

Dependency management
*   All project dependencies (e.g., `next`, `tsx`, `react`, `@connectrpc/*`) should be listed in `package.json` files.
    *    Note: This does not apply to system-level tools: `bash`, `node`, and `pnpm`.
*   All dependencies must be installable by running `pnpm install --recursive`.
*   You are free to add any other dependencies needed to complete the task.

## Requirements

#### Data Streaming
*   Stream live cryptocurrency prices directly from TradingView using Playwright.
*   Target URLs follow the format: `https://www.tradingview.com/symbols/{ticker}/?exchange=BINANCE`.
    *   The `{ticker}` variable represents a valid cryptocurrency symbol (e.g., BTCUSD, ETHUSD, SOLUSD). A complete list of tickers is available at https://www.tradingview.com/markets/cryptocurrencies/prices-all/
    *   For implementation simplicity, the `exchange` is standardized to BINANCE.


#### General
*   **Visibility:** Run Playwright in headed mode (not headless) so we can observe the browser automation in action.
*   **Logging:** Use `console.*` on both the backend and frontend to log key events. This helps us understand the application's behavior.
*   **UI:** The list of tickers displayed on the user interface must be sorted alphabetically.

## Evaluation Criteria
Your submission will be evaluated on the following criteria:

*   **Functionality**
    *   Correct implementation of adding and removing tickers.
    *   Accurate, real-time price updates streamed from TradingView.
*   **Code Quality**
    *   Clean, simple, and maintainable code.
    *   Graceful handling of corner cases and network errors.
*   **Scalability & Efficiency:**
    *   The server architecture must be scalable to support many concurrent clients, primarily through the efficient reuse and sharing of Playwright resources.
    *   While micro-optimizations are not required, the solution should avoid significant performance bottlenecks.
*   **Low-Latency Price Streaming**
    *   Price updates from the TradingView page should be reflected on the client with minimal delay.
    *   We prefer a push-based architecture over polling, which can introduce unnecessary delays.

The following aspects will **NOT** be evaluated:

*   **UI Aesthetics** A polished UI is not necessary as long as the application is fully functional.
*   **Commit History** You may use brief or empty commit messages.

## Running Your Submission
We will use the following steps to run your project. Please ensure that your submission is configured correctly for this.

Our testing environment is Debian Linux and `bash`, `node`, and `pnpm` are pre-installed.

1.  Run `pnpm install --recursive` to install all dependencies.
2.  Run `./run.sh` to launch the application.
    *   This single script should handle all necessary steps, including code generation (e.g., `buf generate`) and starting both the frontend and backend servers.
3.  Open `http://localhost:3000` in a web browser.
4.  Test the functionality by adding and removing various tickers.

## Submission
*   The submission deadline is **7 days** after you receive access to this repository.
*   Commit your changes directly to this repository. Do not create a fork.
*   We encourage incremental commits to help us understand your development process.
*   Please do not delete existing files in this repository, though you may modify them as needed.
*   You are allowed to use any AI tools.
*   If you have any additional comments or notes about your submission, please add them to a `COMMENT.md` file in the root of the repository.
*   If you have any questions or need hints, please email `careers@projectpluto.co`.

#### When you are ready to submit:

Please send an email with the following details:
*   **To:** `careers@projectpluto.co`
*   **Subject:** `Fullstack Engineer Coding Assessment Submission`
*   **Body:** Include a link to this repository.

After submitting, we ask that you delete your local copy of the repository. We will inform you of our decision within one week. Should you not hear back from us in that timeframe, please do not hesitate to reach out.