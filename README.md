# Beer Distribution Game Simulator
This project uses [Node.js](https://nodejs.org/en/) + [Socket.io](https://socket.io/) to provide a modern, browser-based, real-time simulation of the [Beer Distribution Game developed by MIT Sloan](https://en.wikipedia.org/wiki/Beer_distribution_game) in the 1960s. This simulation is easy to setup and has been successfuly used to quickly teach people the key principles of supply chain management. The included graphs and tables allow you to rank groups and observe the [bullwhip effect](https://en.wikipedia.org/wiki/Bullwhip_effect). You can try out a [live demo here](http://beerdistribution.herokuapp.com/).

## Technical ##
### Installation ###
All the game requires is a Node server to run (i.e., you can just upload to a Heroku instance and be on your way) as it doesn't persist any data outside of memory. Dependencies can be installed using `npm install` and the server can be run using `node index.js`.

### AI Players (Optional) ###
The simulator now supports AI-powered players using OpenAI, Anthropic Claude, and Google Gemini APIs. To enable AI players:

1. Set the `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and/or `GOOGLE_API_KEY` environment variable(s) in a `.env` file
2. Configure available models in the `AI_MODELS` array in `index.js`
3. In the admin panel, use the "Add Team" button to create teams with AI players
4. Select "Human" or an AI model (GPT, Claude, or Gemini) for each of the 4 roles

AI players will automatically:
- Accept inbound shipments
- Fulfill orders from downstream
- Use the selected LLM API to decide how much to order from upstream suppliers
- Consider inventory costs, backlog costs, demand trends, and supply chain dynamics

**API Support:**
- OpenAI models (prefix `gpt-*` or `o1-*`): gpt-4o-mini, gpt-4o
- Claude models (prefix `claude-*`): claude-3-5-sonnet-20241022, claude-3-5-haiku-20241022
- Gemini models (prefix `gemini-*`): gemini-2.0-flash-exp, gemini-1.5-pro

**Note:** Running without API keys is supported - AI players will use simple fallback logic.

### Overview ###
The source code is pretty simple. The server is wholly contained in `index.js` and the client is in `/public`, split into the user side (`client.js` and `index.html`) and admin side (`admin.html` and `admin.js`). There's a couple of font styles contained in `style.css`.

This code uses the excellent [animate.css](http://daneden.me/animate), [CountUp.js](https://inorganik.github.io/countUp.js/), and [Bootstrap Validator](http://1000hz.github.io/bootstrap-validator/) libraries.

## Game ##
### Setup ###
Once the server is running, users can connect using a desktop or mobile browser. They must create a unique username at which point they are assigned to a group. To prevent collusion that could ruin the simulation, users don't see who else is in their group until the end.

The game requires at least one group of 4 players, but can theoretically support an unlimited number of groups. Human players are automatically assigned to empty human slots in teams, or a new all-human team is created if no slots are available.

The administrator can create teams with mixed human and AI players using the "Add Team" button in the admin panel. AI players will automatically make ordering decisions throughout the game.

An administrator can login using the `admin.html` page with the password `admin`. From there, they can control the game, add teams with AI players, manage groups, and view analytics.

### Gameplay ###
The game is turn-based, with every turn representing a "week" of gameplay. A turn consists of users receiving orders, fulfilling orders, and then submitting an order request up the chain. Each group can advance from week to week independently, but a group must wait until all members have submitted a new order before auto-advancing to the next week. A typical game should run around 30-40 weeks but the game has no set limit.

## Contributing ##
There are a number of outstanding features that would be nice to add. In addition, there are likely still some bugs with the mechanics. All changes are welcome! To contribute, you can follow the standard GitHub flow:
* Submit your issue, assuming one does not already exist.
 * Clearly describe the issue including steps to reproduce when it is a bug.
 * Fork the repository on GitHub
* Create a topic branch from where you want to base your work.
  * This is usually the master branch.
  * To quickly create a topic branch based on master; `git checkout -b
    fix/master/my_contribution master`. Please avoid working directly on the
    `master` branch.
* Make commits of logical units.
 * Check for unnecessary whitespace with `git diff --check` before committing.
 * Make sure your commit messages are descriptive.
* Push your changes to a topic branch in your fork of the repository.
* Submit a pull request to this repository referencing the issue.
