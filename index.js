/* ========================================================================
 * Beer Distribution Game Simulator: index.js
 * ========================================================================
 * The MIT License (MIT)
 *
 * Copyright (c) 2016-2017 Miron Vranjes. All Rights Reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 * ======================================================================== */

// Load environment variables from .env file (only for local development)
// Railway and other platforms inject environment variables directly
try {
    require('dotenv').config();
} catch (e) {
    // dotenv not available or .env file doesn't exist - this is fine for production
}

var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
var OpenAI = require('openai');
var Anthropic = require('@anthropic-ai/sdk');
var { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize OpenAI client
var openai = null;
if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
    });
    console.log('OpenAI client initialized for AI players');
} else {
    console.log('Warning: OPENAI_API_KEY not set.');
}

// Initialize Claude client
var claude = null;
if (process.env.ANTHROPIC_API_KEY) {
    claude = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY
    });
    console.log('Claude client initialized for AI players');
} else {
    console.log('Warning: ANTHROPIC_API_KEY not set.');
}

// Initialize Gemini client
var gemini = null;
if (process.env.GEMINI_API_KEY) {
    gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    console.log('Gemini client initialized for AI players');
} else {
    console.log('Warning: GEMINI_API_KEY not set.');
}

var groups = [];
var users = {};
var roles = [];

var numUsers = 0;
var gameStarted = false;
var gameEnded = false;

// Configuration: Available AI models
var AI_MODELS = ['gpt-5-mini', 'gpt-5.2', 'claude-sonnet-4-5', 'claude-opus-4-5', 'gemini-3-flash-preview', 'gemini-3-pro-preview'];

// AI configuration
var aiThinkingDelay = 1500; // Simulate thinking time
var maxRetries = 3; // Maximum retry attempts for 429 errors

var inventory_cost = 0.5;
var backlog_cost = 1;
var starting_inventory = 12;
var starting_throughput = 4;
var customer_demand = [4, 8, 12, 16, 20];

// Maximum number of weeks to demonstrate the bullwhip effect
// 40 weeks captures: initial stability (8 weeks), demand changes (weeks 8-39), and adaptation
var MAX_WEEKS = 40;

// This controls how the roles are labeled
var BEER_NAMES = ["Retailer", "Wholesaler", "Regional Warehouse", "Factory"];

// This is what stores all the role data during the game
var ROLE_0 = {
    "name": BEER_NAMES[0],
    "upstream": {
        "name": BEER_NAMES[1],
        "orders": starting_throughput,
        "shipments": starting_throughput
    },
    "downstream": {
        "name": "Customer",
        "orders": starting_throughput,
        "shipments": starting_throughput
    }
};
var ROLE_1 = {
    "name": BEER_NAMES[1],
    "upstream": {
        "name": BEER_NAMES[2],
        "orders": starting_throughput,
        "shipments": starting_throughput
    },
    "downstream": {
        "name": BEER_NAMES[0],
        "orders": starting_throughput,
        "shipments": starting_throughput
    }
};
var ROLE_2 = {
    "name": BEER_NAMES[2],
    "upstream": {
        "name": BEER_NAMES[3],
        "orders": starting_throughput,
        "shipments": starting_throughput
    },
    "downstream": {
        "name": BEER_NAMES[1],
        "orders": starting_throughput,
        "shipments": starting_throughput
    }
};
var ROLE_3 = {
    "name": BEER_NAMES[3],
    "upstream": {
        "name": "Factory",
        "orders": starting_throughput,
        "shipments": starting_throughput
    },
    "downstream": {
        "name": BEER_NAMES[2],
        "orders": starting_throughput,
        "shipments": starting_throughput
    }
};

// This array is used for assinging roles
var BEER_ROLES = [ROLE_0, ROLE_1, ROLE_2, ROLE_3];

// Everything in public is served up
app.use(express.static(__dirname + '/public'));

// Users has established a connection
io.on('connection', function (socket) {
    var addedUser = false;

    // Register the user (can only happen when a game is not in progress)
    // If a user leaves by accident, try to put them back in their group (if they give the same username)
    socket.on('submit username', function (msg, callback) {
        if (addedUser) return;

        console.log(socket.id + ": " + msg);
        var user = registerUser(socket.id, msg);

        if (user) {
            ++numUsers;
            socket.name = user.name;
            addedUser = true;
            callback({ numUsers: numUsers, idx: user.index, group: groups[user.group], gameEnded: gameEnded });
            socket.join(user.group);

            if (!gameStarted && !gameEnded) io.to(user.group).emit('group member joined', { idx: user.index, update: groups[user.group].users[user.index] });

            socket.broadcast.emit('user joined', {
                username: socket.name,
                numUsers: numUsers
            });
            io.to("admins").emit('update table', { numUsers: numUsers, groups: groups });
        } else {
            if (gameStarted || gameEnded) {
                callback("Game Started");
            } else {
                callback("Invalid Username");
            }
        }
    });

    // User has left, update groups
    socket.on('disconnect', function () {
        console.log('Got disconnected!');
        if (addedUser) {
            var user = users[socket.name];
            if (user.socketId) delete users[socket.name].socketId;
            delete groups[user.group].users[user.index].socketId;

            --numUsers;

            if (!gameStarted) io.to(user.group).emit('group member left', {
                idx: user.index,
                update: groups[user.group].users[user.index]
            });

            socket.broadcast.emit('user left', {
                username: socket.name,
                numUsers: numUsers
            });
            io.to("admins").emit('update table', { numUsers: numUsers, groups: groups });
        }
    });

    // This is called by the admin system
    socket.on('submit password', function (msg, callback) {
        // Not very secure :P
        if (msg == "admin") {
            socket.join("admins");

            var gameStatus = "";
            if (gameStarted && !gameEnded) {
                gameStatus = "started";
            } else if (gameStarted && gameEnded) {
                gameStatus = "ended";
            } else {
                gameStatus = "waiting";
            }

            callback({ status: gameStatus, numUsers: numUsers, groups: groups, aiModels: AI_MODELS });
        } else {
            callback("Invalid Password");
        }
    });

    // Admin creates a team with specified player types
    socket.on('create team', function (playerTypes, callback) {
        if (gameStarted || gameEnded) {
            return callback({ err: "Cannot create teams after game has started." });
        }

        if (!playerTypes || playerTypes.length !== 4) {
            return callback({ err: "Must specify player type for all 4 roles." });
        }

        // Create new team with specified player types
        var newGroup = { week: 0, cost: 0, users: [] };
        
        // Get fresh roles for this team
        var teamRoles = JSON.parse(JSON.stringify(BEER_ROLES));
        var aiPlayersCount = 0;
        
        for (var i = 0; i < 4; i++) {
            var playerType = playerTypes[i];
            var role = teamRoles[i];
            
            if (playerType === 'human') {
                // Create empty slot for human player
                var user = {
                    "name": null,
                    "socketId": null,
                    "cost": 0,
                    "inventory": starting_inventory,
                    "backlog": 0,
                    "role": role,
                    "playerType": "human"
                };
                newGroup.users.push(user);
            } else {
                // Create AI player slot (playerType is the model name like 'gpt-4o', 'o1', etc.)
                aiPlayersCount++;
                var aiName = "AI-" + playerType + "-" + role.name;
                var user = {
                    "name": aiName,
                    "socketId": "AI",
                    "cost": 0,
                    "inventory": starting_inventory,
                    "backlog": 0,
                    "role": role,
                    "playerType": playerType
                };
                newGroup.users.push(user);
            }
        }
        
        groups.push(newGroup);
        
        // Increment numUsers by the number of AI players created
        numUsers += aiPlayersCount;
        
        callback({ numUsers: numUsers, groups: groups });
        io.to("admins").emit('update table', { numUsers: numUsers, groups: groups });
    });

    // Acknowledge the change group
    socket.on('change group', function (msg) {
        socket.leave(msg + 1);
        socket.join(msg);
    });

    // Handshake on boot
    socket.on('ack getting kicked', function (msg) {
        console.log("Ack");
        addedUser = false;
    });

    // Admin has kicked this group out
    socket.on('remove group', function (msg, callback) {
        if (msg == "" || msg >= groups.length || msg < 0) {
            callback("Error");
        } else {
            var usersToRemove = groups[msg].users.length;

            // Get rid of the user in the system
            for (var i = 0; i < groups[msg].users.length; i++) {
                var username = groups[msg].users[i].name;
                console.log("Deleting: " + username);
                // Only delete from users object if it's a human player (AI players aren't in users object)
                if (users[username]) {
                    delete users[username];
                }
            }
            groups.splice(msg, 1);
            numUsers -= usersToRemove;

            // Tell them they're out
            io.to(msg).emit('kicked out', msg);

            // Update all references
            for (var i = msg; i < groups.length; i++) {
                for (var j = 0; j < groups[i].users.length; j++) {
                    var username = groups[i].users[j].name;
                    users[username].group--;
                    io.to(users[username].socketId).emit('change group subscription', users[username].group);
                }
            }

            callback({ numUsers: numUsers, groups: groups });
        }
    });

    // Admin has started the game
    socket.on('start game', function (callback) {
        var canStart = true;
        var gameEnded = false;
        if (gameStarted) {
            return callback({ err: "The game has already begun." });
        } else {
            if (groups.length == 0) {
                return callback({ err: "You need at least one team to play the game." });
            }
            
            // Check if all teams have 4 players (human or AI)
            for (var i = 0; i < groups.length; i++) {
                if (groups[i].users.length < 4) {
                    return callback({ err: "All teams must have 4 players before you can start the game." });
                }
                // Check if all human slots are filled
                for (var j = 0; j < groups[i].users.length; j++) {
                    var user = groups[i].users[j];
                    if (user.playerType === 'human' && (!user.name || !user.socketId)) {
                        return callback({ err: "All human player slots must be filled before you can start the game." });
                    }
                }
            }

            gameStarted = true;
            callback({ numUsers: numUsers });

            for (var i = 0; i < groups.length; i++) {
                io.to(i).emit('game started', {
                    numUsers: numUsers,
                    week: 0
                });
                advanceTurn(i);
            }
        }
    });

    // Admin has reset a game already in progress
    socket.on('reset game', function (callback) {
        if (!gameStarted) {
            callback("Error");
        } else {
            gameStarted = false;
            gameEnded = false;
            resetGame();
            callback({ numUsers: numUsers, groups: groups });

            socket.broadcast.emit('game reset', {
                numUsers: numUsers,
                week: 0
            });
        }
    });

    // Admin has ended the game
    socket.on('end game', function (callback) {
        if (!gameStarted || gameEnded) {
            callback("Error");
        } else {
            gameEnded = true;
            callback({ numUsers: numUsers, groups: groups });

            socket.broadcast.emit('game ended', {
                numUsers: numUsers
            });
        }
    });

    // You've got an order from someone in a group
    socket.on('submit order', function (order, callback) {
        var user = users[socket.name];
        var group = groups[user.group];

        // Prevent orders if game ended or max weeks reached
        if (gameEnded || group.week >= MAX_WEEKS) {
            return callback({ err: "Game has ended" });
        }

        console.log("User: " + socket.name);
        console.log("Group: " + user.group);
        console.log("Order: " + order);

        // Push the order
        group.users[user.index].role.upstream.orders = parseInt(order);

        console.log("Remaining: " + group.waitingForOrders);

        // Reduce the list of outstanding orders
        var search_term = group.users[user.index].role.name;
        var index = group.waitingForOrders.indexOf(search_term);
        if (index !== -1) {
            group.waitingForOrders.splice(index, 1);
        }

        // Either advance the turn or we're waiting
        if (group.waitingForOrders.length == 0) {
            callback();
            advanceTurn(user.group);
        } else {
            callback(group.waitingForOrders);
            io.to(user.group).emit('update order wait', group.waitingForOrders);
        }
    });
});

// This is the server
http.listen(process.env.PORT || 3000, function () {
    console.log('Beer Distribution Game Simulator engaged! Listening...');
});

// This is where all the turn calculation happens... dragons live here
function advanceTurn(group) {
    var groupToAdvance = groups[group];

    // Initial turn, fill out the buffers
    if (groupToAdvance.week == 0) {
        groupToAdvance.waitingForOrders = BEER_NAMES;

        groupToAdvance.shipping = [];
        groupToAdvance.mailing = [];
        groupToAdvance.costHistory = [];

        for (var i = 0; i < 3; i++) {
            groupToAdvance.shipping.push([starting_throughput, starting_throughput]);
            groupToAdvance.mailing.push([starting_throughput]);
        }

        groupToAdvance.shipping.push([starting_throughput, starting_throughput]);
    }

    // Loop through all the roles
    for (var i = 0; i < groupToAdvance.users.length; i++) {
        console.log("\n " + groupToAdvance.week + " #####################\n");
        var curUser = groupToAdvance.users[i];

        if (groupToAdvance.week == 0) {
            curUser.inventoryHistory = [];
            curUser.backlogHistory = [];
            curUser.costHistory = [];
            curUser.orderHistory = [];
        }

        // Compute cost
        curUser.costHistory.push(curUser.cost);
        curUser.inventoryHistory.push(curUser.inventory);
        curUser.backlogHistory.push(curUser.backlog);

        console.log("[" + curUser.role.name + "] " + "Previous Shipment from Upstream <<<: " + curUser.role.upstream.shipments + " [" + groupToAdvance.shipping[i] + "]");
        curUser.role.upstream.shipments = groupToAdvance.shipping[i].shift();
        console.log("[" + curUser.role.name + "] " + "New Shipment from Upstream <<<: " + curUser.role.upstream.shipments + " [" + groupToAdvance.shipping[i] + "]");
        console.log("[" + curUser.role.name + "] " + "Previous Inventory: " + curUser.inventory);
        curUser.inventory += curUser.role.upstream.shipments;
        console.log("[" + curUser.role.name + "] " + "New Inventory: " + curUser.inventory);

        // If start, get order from customer directly
        if (i == 0) {
            if (groupToAdvance.week < 8) {
                curUser.role.downstream.orders = customer_demand[0];
            } else if (groupToAdvance.week < 19) {
                curUser.role.downstream.orders = customer_demand[1];
            } else if (groupToAdvance.week < 26) {
                curUser.role.downstream.orders = customer_demand[2];
            } else if (groupToAdvance.week < 39) {
                curUser.role.downstream.orders = customer_demand[3];
            } else {
                curUser.role.downstream.orders = customer_demand[4];
            }
            console.log("[" + curUser.role.name + "] " + " Customer Order >>>: " + curUser.role.downstream.orders);
        } else {
            // Otherwise the order is from the previous node
            console.log("[" + curUser.role.name + "] " + " Prev Downstream Order >>>: " + curUser.role.downstream.orders + " [" + groupToAdvance.mailing[i - 1] + "]");
            curUser.role.downstream.orders = groupToAdvance.mailing[i - 1].shift();
            console.log("[" + curUser.role.name + "] " + " New Downstream Order >>>: " + curUser.role.downstream.orders + " [" + groupToAdvance.mailing[i - 1] + "]");
        }

        var toShip = curUser.backlog + curUser.role.downstream.orders;
        console.log("[" + curUser.role.name + "] " + "To Ship <<<: " + toShip);
        curUser.role.downstream.shipments = (toShip > curUser.inventory ? curUser.inventory : toShip);
        console.log("[" + curUser.role.name + "] " + "Actually Shipped <<<: " + curUser.role.downstream.shipments);

        // Push the shipment back down the queue
        if (i != 0) {
            console.log("[" + curUser.role.name + "] " + "Prev Ship <<<: [" + groupToAdvance.shipping[i - 1] + "]");
            groupToAdvance.shipping[i - 1].push(curUser.role.downstream.shipments);
            console.log("[" + curUser.role.name + "] " + "Next Ship <<<: [" + groupToAdvance.shipping[i - 1] + "]");
        }

        console.log("[" + curUser.role.name + "] " + "Prev Backlog: " + curUser.backlog);
        curUser.backlog = (toShip > curUser.inventory) ? toShip - curUser.inventory : 0;
        console.log("[" + curUser.role.name + "] " + "New Backlog: " + curUser.backlog);
        curUser.inventory = (toShip > curUser.inventory) ? 0 : curUser.inventory - toShip;
        console.log("[" + curUser.role.name + "] " + "New Inventory: " + curUser.inventory);

        // First turn
        if (groupToAdvance.week == 0) {
            curUser.role.upstream.orders = starting_throughput;
        }
        console.log("[" + curUser.role.name + "] " + "Upstream Order >>>: " + curUser.role.upstream.orders);

        // If it's the factory, push the order into the production queue, otherwise mail the order
        if (i == 3) {
            console.log("[" + curUser.role.name + "] " + "Prev Mail >>>: [" + groupToAdvance.shipping[i] + "]");
            groupToAdvance.shipping[i].push(curUser.role.upstream.orders);
            console.log("[" + curUser.role.name + "] " + "Next Mail >>>: [" + groupToAdvance.shipping[i] + "]");
        } else {
            console.log("[" + curUser.role.name + "] " + "Prev Mail >>>: [" + groupToAdvance.mailing[i] + "]");
            groupToAdvance.mailing[i].push(curUser.role.upstream.orders);
            console.log("[" + curUser.role.name + "] " + "Next Mail >>>: [" + groupToAdvance.mailing[i] + "]");
        }

        curUser.orderHistory.push(curUser.role.upstream.orders);
        groupToAdvance.cost += curUser.cost;

        console.log("[" + curUser.role.name + "] " + "Cost Pushed: $" + curUser.cost);
        curUser.cost += curUser.inventory * inventory_cost + curUser.backlog * backlog_cost;
        console.log("[" + curUser.role.name + "] " + "New Cost: $" + curUser.cost);

        console.log("\n#####################\n");
    }

    groupToAdvance.costHistory.push(groupToAdvance.cost);

    // Next week
    groupToAdvance.week++;
    groupToAdvance.waitingForOrders = JSON.parse(JSON.stringify(BEER_NAMES));

    // Check if this group has reached max weeks
    if (groupToAdvance.week >= MAX_WEEKS) {
        console.log("[Game] Group " + group + " has completed " + MAX_WEEKS + " weeks");
        
        // Check if all groups have reached max weeks
        var allGroupsComplete = true;
        for (var g = 0; g < groups.length; g++) {
            if (groups[g].week < MAX_WEEKS) {
                allGroupsComplete = false;
                break;
            }
        }
        
        // If all groups are done, end the game
        if (allGroupsComplete && !gameEnded) {
            gameEnded = true;
            console.log("[Game] All groups completed " + MAX_WEEKS + " weeks. Game ended automatically.");
            io.emit('game ended', { numUsers: numUsers, groups: groups });
            io.to("admins").emit('update table', { numUsers: numUsers, groups: groups });
        }
    }

    // Message to each user
    for (var i = 0; i < groupToAdvance.users.length; i++) {
        // Time to let the person know
        io.to(groupToAdvance.users[i].socketId).emit('next turn', {
            numUsers: numUsers,
            week: groupToAdvance.week,
            update: groupToAdvance.users[i]
        });
    }

    io.to("admins").emit('update group', { groupNum: group, groupData: groupToAdvance, numUsers: numUsers });
    
    // Process AI player orders automatically (only if game hasn't ended)
    if (!gameEnded && groupToAdvance.week < MAX_WEEKS) {
        processAiOrders(group);
    }
}

// Reset the game
function resetGame() {
    for (var i = 0; i < groups.length; i++) {
        groups[i].week = 0;
        groups[i].cost = 0;

        roles = JSON.parse(JSON.stringify(BEER_ROLES));
        // Reset all the users
        for (var j = 0; j < groups[i].users.length; j++) {
            groups[i].users[j].role = roles.shift();
            groups[i].users[j].cost = 0;
            groups[i].users[j].inventory = starting_inventory;
            groups[i].users[j].backlog = 0;
        }
    }
}

// Register a user
function registerUser(socketId, userName) {
    console.log(users);
    // Does the user already exist? If so, verify it's a disconnect
    if (users[userName]) {
        var user = users[userName];
        if (user.socketId) return null;

        groups[user.group].users[user.index].socketId = socketId;
        user.socketId = socketId;
        return users[userName];
    }

    if (gameStarted) return null;

    // Try to find an empty human slot in existing teams first
    for (var i = 0; i < groups.length; i++) {
        for (var j = 0; j < groups[i].users.length; j++) {
            var slot = groups[i].users[j];
            // Check if this is an empty human slot (playerType === 'human' and no socketId)
            if (slot.playerType === 'human' && !slot.socketId && !slot.name) {
                // Assign this user to the empty slot (role is already set from team creation)
                slot.name = userName;
                slot.socketId = socketId;
                
                var userLookup = { "name": userName, "socketId": socketId, "group": i, "index": j };
                users[userName] = userLookup;
                return userLookup;
            }
        }
    }

    // No empty human slots found, create a new human-only team (original behavior)
    // Okay, get them a role
    if (roles.length == 0) roles = JSON.parse(JSON.stringify(BEER_ROLES));
    var userRole = roles.shift();

    // Assign them to a group
    if (groups.length == 0) groups.push({ week: 0, cost: 0, users: [] });
    var lastGroup = groups[groups.length - 1];

    var user = { "name": userName, "socketId": socketId, "cost": 0, "inventory": starting_inventory, "backlog": 0, "role": userRole, "playerType": "human" };
    if (lastGroup.users.length < 4) {
        lastGroup.users.push(user);
    } else {
        var newGroup = { week: 0, cost: 0, users: [] };
        newGroup.users.push(user);
        groups.push(newGroup);
    }

    var userLookup = { "name": userName, "socketId": socketId, "group": groups.length - 1, "index": groups[groups.length - 1].users.length - 1 };
    // Let's update our big table
    console.log(user);
    users[userName] = userLookup;
    return userLookup;
}

// Process AI player orders for a group
async function processAiOrders(groupIndex) {
    var group = groups[groupIndex];
    
    // Prevent processing if game ended
    if (gameEnded) return;
    
    var aiPlayers = [];
    
    // Find all AI players in this group
    for (var i = 0; i < group.users.length; i++) {
        var user = group.users[i];
        if (user.playerType && user.playerType !== 'human') {
            aiPlayers.push({ user: user, index: i });
        }
    }
    
    // If no AI players, nothing to do
    if (aiPlayers.length === 0) return;
    
    // Add initial thinking delay
    await sleep(aiThinkingDelay);
    
    // Process all AI players in parallel using Promise.all
    var aiPromises = aiPlayers.map(async function(aiPlayer) {
        try {
            var orderDecision = await getAiOrderDecision(aiPlayer.user, group);
            
            // Submit the order
            aiPlayer.user.role.upstream.orders = orderDecision;
            console.log("[AI] " + aiPlayer.user.name + " ordered: " + orderDecision);
            
            // Remove from waiting list
            var search_term = aiPlayer.user.role.name;
            var idx = group.waitingForOrders.indexOf(search_term);
            if (idx !== -1) {
                group.waitingForOrders.splice(idx, 1);
            }
            
            return { success: true, player: aiPlayer };
            
        } catch (error) {
            console.error("[AI Error] Failed to get decision for " + aiPlayer.user.name + ":", error);
            // Default fallback order
            var fallbackOrder = aiPlayer.user.role.downstream.orders || starting_throughput;
            aiPlayer.user.role.upstream.orders = fallbackOrder;
            
            var search_term = aiPlayer.user.role.name;
            var idx = group.waitingForOrders.indexOf(search_term);
            if (idx !== -1) {
                group.waitingForOrders.splice(idx, 1);
            }
            
            return { success: false, player: aiPlayer, error: error };
        }
    });
    
    // Wait for all AI decisions to complete
    await Promise.all(aiPromises);
    
    // Notify clients about updated waiting list
    io.to(groupIndex).emit('update order wait', group.waitingForOrders);
    
    // After all AI orders are in, check if we can advance (only if game hasn't ended)
    if (group.waitingForOrders.length == 0 && !gameEnded) {
        advanceTurn(groupIndex);
    } else {
        io.to(groupIndex).emit('update order wait', group.waitingForOrders);
    }
}

// Get AI decision for ordering
async function getAiOrderDecision(user, group) {
    var modelName = user.playerType;
    
    // Determine which API to use based on model name
    var isClaudeModel = modelName.startsWith('claude');
    var isOpenAIModel = modelName.startsWith('gpt') || modelName.startsWith('o1');
    var isGeminiModel = modelName.startsWith('gemini');
    
    // Check if appropriate client is initialized
    if (isClaudeModel && !claude) {
        console.log("[AI Fallback] Claude API not available for " + user.name);
        return user.role.downstream.orders || starting_throughput;
    }
    if (isOpenAIModel && !openai) {
        console.log("[AI Fallback] OpenAI API not available for " + user.name);
        return user.role.downstream.orders || starting_throughput;
    }
    if (isGeminiModel && !gemini) {
        console.log("[AI Fallback] Gemini API not available for " + user.name);
        return user.role.downstream.orders || starting_throughput;
    }
    
    // Route to appropriate API
    if (isClaudeModel) {
        return await getClaudeDecision(user, group, modelName);
    } else if (isOpenAIModel) {
        return await getOpenAIDecision(user, group, modelName);
    } else if (isGeminiModel) {
        return await getGeminiDecision(user, group, modelName);
    } else {
        console.log("[AI Fallback] Unknown model type for " + user.name);
        return user.role.downstream.orders || starting_throughput;
    }
}

// Common function to handle AI decision with retry logic
async function getAiDecisionWithRetry(user, group, modelName, apiCaller) {
    var prompt = buildPrompt(user, group);
    
    console.log("[AI] Requesting decision from " + modelName + " for " + user.role.name);
    
    // Retry loop for handling 429 errors
    var retryCount = 0;
    while (retryCount < maxRetries) {
        try {
            // Call the provider-specific API
            var decision = await apiCaller(modelName, prompt);
            
            // Try to extract a number from the response
            var match = decision.match(/\d+/);
            var orderQuantity = match ? parseInt(match[0]) : NaN;
            
            // Validate and constrain the order
            if (isNaN(orderQuantity) || orderQuantity < 0) {
                console.log("[AI] Invalid response, using fallback. Response was: " + decision);
                orderQuantity = user.role.downstream.orders || starting_throughput;
            }
            
            return orderQuantity;
            
        } catch (error) {
            // Check if this is a rate limit error (429)
            var is429 = error.status === 429 || (error.message && error.message.includes('429'));
            
            if (is429) {
                retryCount++;
                
                // Extract retry-after from headers or use default
                var retryAfter = 5;
                if (error.headers && error.headers['retry-after']) {
                    retryAfter = parseInt(error.headers['retry-after']);
                } else if (error.response && error.response.headers && error.response.headers['retry-after']) {
                    retryAfter = parseInt(error.response.headers['retry-after']);
                } else if (error.error && error.error.message) {
                    var match = error.error.message.match(/retry after (\d+) second/);
                    if (match) {
                        retryAfter = parseInt(match[1]);
                    }
                }
                
                console.log("[AI] Rate limit hit (429) for " + modelName + ", retry " + retryCount + "/" + maxRetries + " after " + retryAfter + " seconds");
                
                if (retryCount < maxRetries) {
                    await sleep(retryAfter * 1000);
                    continue;
                } else {
                    console.log("[AI] Max retries reached, using fallback");
                    return user.role.downstream.orders || starting_throughput;
                }
            } else {
                console.error("[AI Error] Failed to get decision for " + user.name + ":", error.message || error);
                return user.role.downstream.orders || starting_throughput;
            }
        }
    }
    
    return user.role.downstream.orders || starting_throughput;
}

// Provider-specific API callers
async function callOpenAI(modelName, prompt) {
    var messages = [
        {
            role: "system",
            content: "You are a supply chain manager making ordering decisions. Respond with ONLY a single integer number representing the quantity to order."
        },
        {
            role: "user",
            content: prompt
        }
    ];
    
    var response = await openai.chat.completions.create({
        model: modelName,
        messages: messages,
        reasoning_effort: 'medium'
    });
    
    return response.choices[0].message.content.trim();
}

async function callClaude(modelName, prompt) {
    var response = await claude.messages.create({
        model: modelName,
        max_tokens: 100,
        messages: [
            {
                role: "user",
                content: "You are a supply chain manager making ordering decisions. " + prompt + "\n\nRespond with ONLY a single integer number (no explanation)."
            }
        ]
    });
    
    return response.content[0].text.trim();
}

async function callGemini(modelName, prompt) {
    var model = gemini.getGenerativeModel({ model: modelName });
    var result = await model.generateContent(
        "You are a supply chain manager making ordering decisions. " + prompt + "\n\nRespond with ONLY a single integer number (no explanation)."
    );
    
    var response = await result.response;
    return response.text().trim();
}

// Wrapper functions for each provider
async function getOpenAIDecision(user, group, modelName) {
    return await getAiDecisionWithRetry(user, group, modelName, callOpenAI);
}

async function getClaudeDecision(user, group, modelName) {
    return await getAiDecisionWithRetry(user, group, modelName, callClaude);
}

async function getGeminiDecision(user, group, modelName) {
    return await getAiDecisionWithRetry(user, group, modelName, callGemini);
}

// Build prompt for AI decision
function buildPrompt(user, group) {
    var role = user.role;
    var week = group.week;
    
    var prompt = `You are a ${role.name} in a supply chain network. Your position is between ${role.downstream.name} (your customer) and ${role.upstream.name} (your supplier).

OBJECTIVE: Minimize costs while meeting customer demand.

COST STRUCTURE:
- Holding inventory costs $${inventory_cost} per unit per week
- Unmet demand (backlog) costs $${backlog_cost} per unit per week

CURRENT STATE (Week ${week}):
- Current inventory: ${user.inventory} units (includes shipment of ${role.upstream.shipments} units that just arrived)
- Current backlog: ${user.backlog} units
- Customer demand from ${role.downstream.name}: ${role.downstream.orders} units
- Total cost so far: $${user.cost.toFixed(2)}
`;
    
    // Add history if available
    if (user.inventoryHistory && user.inventoryHistory.length > 0) {
        prompt += `RECENT HISTORY (last ${Math.min(5, user.inventoryHistory.length)} weeks):\n`;
        var historyLength = Math.min(5, user.inventoryHistory.length);
        for (var i = Math.max(0, user.inventoryHistory.length - historyLength); i < user.inventoryHistory.length; i++) {
            prompt += `Week ${i}: Inventory=${user.inventoryHistory[i]}, Backlog=${user.backlogHistory[i]}, Order Placed=${user.orderHistory[i] || 'N/A'}\n`;
        }
    }
    
    prompt += `
Think like an experienced supply chain manager. Consider demand trends, lead times, and cost trade-offs when making your decision. Follow the best practices in inventory management. Beware of the bullwhip effect and avoid over-ordering.

DECISION REQUIRED:
How many units should you order from ${role.upstream.name}?

IMPORTANT NOTES:
- Orders take 2 weeks to arrive
- You must balance inventory costs against stockout costs
- Consider demand trends and lead time

Respond with ONLY the number of units to order (e.g., "8" or "12").`;
    
    return prompt;
}

// Sleep utility function
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}