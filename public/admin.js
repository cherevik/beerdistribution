/* ========================================================================
 * Beer Distribution Game Simulator: admin.js
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

var socket = io();
var gameGroup;
var chart;
var aiModels = [];

// Admin page
$(document).ready(function () {
    $('#grouppanel').hide();
    var myModal = new bootstrap.Modal(document.getElementById('myModal'));
    myModal.show();
    $('#btnResetGame').hide();
    $('#btnEndGame').hide();
    $('#btnAddTeam').hide();
    $('#charts').hide();

    // Coming in from the dialog
    $("#btnAdmin").click(function () {
        var password = $('#formPassword').val();
        socket.emit('submit password', password, function (msg) {
            if (msg == "Invalid Password") {
                $('#wrongPassword').show();
            } else {
                bootstrap.Modal.getInstance(document.getElementById('myModal')).hide();
                $('#groupRank').text("Group #");
                gameGroup = msg.groups;
                aiModels = msg.aiModels || [];
                
                // Populate the AI model options in the Add Team modal
                populateAiModelOptions();
                
                refreshTable(gameGroup, msg.numUsers, false);
                $('#grouppanel').show();
                $('#btnAddTeam').show();

                if (msg.status == "started") {
                    startGame(msg.numUsers);
                } else if (msg.status == "ended") {
                    startGame(msg.numUsers);
                    $('#btnEndGame').hide();
                    rankGroups(msg.numUsers);
                }
            }
        });
    });

    // Start the game button
    $("#btnStartGame").click(function () {
        $('#gameStartError').hide();

        socket.emit('start game', function (msg) {
            if (msg.err) {
                $('#errorText').text('The game could not be started. ' + msg.err);
                $('#gameStartError').show();
            } else {
                $('#groupRank').text("Group #");
                startGame(msg.numUsers);
            }
        });
    });

    // Reset the game button
    $("#btnResetGame").click(function () {
        $('#btnStartGame').show();
        $('#btnEndGame').hide();
        $('#btnResetGame').hide();
        $('#btnAddTeam').show();
        $('#charts').hide();

        socket.emit('reset game', function (msg) {
            if (msg == "Error") {
                $('#errorText').text('The game could not be restarted.');
                $('#gameStartError').show();
            } else {
                gameGroup = msg.groups;
                $('#groupRank').text("Group #");
                refreshTable(gameGroup, msg.numUsers, false);
            }
        });
    });

    // Add Team button - show modal
    $("#btnAddTeam").click(function () {
        $('#addTeamError').hide();
        var addTeamModal = new bootstrap.Modal(document.getElementById('addTeamModal'));
        addTeamModal.show();
    });

    // Create Team button in modal
    $("#btnCreateTeam").click(function () {
        $('#addTeamError').hide();
        
        var playerTypes = [
            $('#playerTypeRetailer').val(),
            $('#playerTypeWholesaler').val(),
            $('#playerTypeWarehouse').val(),
            $('#playerTypeFactory').val()
        ];
        
        socket.emit('create team', playerTypes, function (msg) {
            if (msg.err) {
                $('#addTeamErrorText').text(msg.err);
                $('#addTeamError').show();
            } else {
                gameGroup = msg.groups;
                refreshTable(gameGroup, msg.numUsers, false);
                bootstrap.Modal.getInstance(document.getElementById('addTeamModal')).hide();
            }
        });
    });

    // End the game button
    $("#btnEndGame").click(function () {
        $('#btnEndGame').hide();

        socket.emit('end game', function (msg) {
            if (msg == "Error") {
                $('#errorText').text('The game could not be ended.');
                $('#gameStartError').show();
            } else {
                gameGroup = msg.groups;

                rankGroups(msg.numUsers);
            }
        });
    });

    // Removing a group (in case there are not enough players to start)
    $(document).on('click', '.btnRemoveGroup', function () {
        socket.emit('remove group', $(this).attr("group"), function (msg) {
            if (msg == "Error") {
                $('#errorText').text('The group could not be removed.');
                $('#gameStartError').show();
            } else {
                gameGroup = msg.groups;
                refreshTable(gameGroup, msg.numUsers, false);
            }
        });
    });

    // Charting commands
    $("#chartGroup").change(function () {
        var selectedGroup = $("#chartGroup").val();
        var selectedType = $("#chartType").val();
        drawChart(selectedGroup, selectedType);
    });

    $("#chartType").change(function () {
        var selectedGroup = $("#chartGroup").val();
        var selectedType = $("#chartType").val();
        drawChart(selectedGroup, selectedType);
    });
});

// Fired whenever folks join the server
socket.on('update table', function (msg) {
    gameGroup = msg.groups;
    refreshTable(gameGroup, msg.numUsers, false);
});

// Fired whenever a group has finished a week
socket.on('update group', function (msg) {
    gameGroup[msg.groupNum] = msg.groupData;

    refreshTable(gameGroup, msg.numUsers, true);

    var selectedGroup = $("#chartGroup").val();
    var selectedType = $("#chartType").val();
    drawChart(selectedGroup, selectedType);
});

// Fired when the game ends (manually or automatically)
socket.on('game ended', function (msg) {
    $('#btnEndGame').hide();
    gameGroup = msg.groups || gameGroup;
    if (msg.groups) {
        rankGroups(msg.numUsers);
    }
});

// Changes the UI when the game starts
function startGame(numUsers) {
    $('#btnStartGame').hide();
    $('#btnEndGame').show();
    $('#btnResetGame').show();
    $('#btnAddTeam').hide();
    if (numUsers == 1) {
        var numParticipants = "1 participant.";
    } else {
        var numParticipants = numUsers + ' participants.';
    }

    $('#status').text('The game has started with ' + numParticipants);

    refreshTable(gameGroup, numUsers, true);
    showChart();
}

// Sorts the groups by the money they made
function rankGroups(numUsers) {
    $('#groupRank').text("Rank");
    var lowestWeek = gameGroup[gameGroup.length - 1].week;
    for (var i = 0; i < gameGroup.length; i++) {
        if (gameGroup[i].week < lowestWeek) lowestWeek = gameGroup[i].week;
        console.log(gameGroup[i].costHistory);
    }

    gameGroup.sort(function (a, b) {
        console.log(a.costHistory[lowestWeek - 1] + " vs " + b.costHistory[lowestWeek - 1]);
        return a.costHistory[lowestWeek - 1] - b.costHistory[lowestWeek - 1];
    });

    refreshTable(gameGroup, numUsers, true);
}

// Start showing the fancy charts
function showChart() {
    $("#chartGroup").empty(); // remove old options

    for (var i = 0; i < gameGroup.length; i++) {
        $("#chartGroup").append($("<option></option>").attr("value", i).text(i + 1));
    }

    $('#charts').show();

    var selectedGroup = $("#chartGroup").val();
    var selectedType = $("#chartType").val();
    drawChart(selectedGroup, selectedType);
}

// Updates the table of users (this happens in real time)
function refreshTable(groups, numUsers, gameStarted) {
    $('#grouptable > tbody').html("");
    for (var i = 0; i < groups.length; i++) {
        var week = gameStarted ? " (W " + groups[i].week + ", $" + parseFloat(groups[i].cost).toFixed(0) + ")" : ""
        $('#grouptable > tbody').append('<tr id=\'group' + i + '\'><td>' + (i + 1) + week + '</td></tr>');
        var userDisconnected = false;
        for (var j = 0; j < 4; j++) {
            if (groups[i].users[j]) {
                var user = groups[i].users[j];
                var playerTypeLabel = '';
                
                // Determine player type label
                if (user.playerType && user.playerType !== 'human') {
                    playerTypeLabel = ' (' + user.playerType + ')';
                } else if (user.playerType === 'human' && !user.name) {
                    playerTypeLabel = ' (Empty)';
                }
                
                if (user.socketId && user.socketId !== 'AI') {
                    var userCell = '<td>' + user.name + playerTypeLabel + '</td>';
                } else if (user.socketId === 'AI') {
                    var userCell = '<td>' + user.name + '</td>';
                } else if (user.name) {
                    userDisconnected = true;
                    var userCell = '<td>' + user.name + playerTypeLabel + ' (Disconnected)</td>';
                } else {
                    var userCell = '<td>' + playerTypeLabel + '</td>';
                }
            } else {
                var userCell = '<td></td>';
            }
            $('#group' + i).append(userCell);
        }

        // Always add the last column, but only show button when game hasn't started
        if (!gameStarted) {
            $('#group' + i).append('<td><button type="button" class="btn btn-danger btn-sm btnRemoveGroup" group="' + i + '"><i class="bi bi-x-circle"></i></button></td>');
        } else {
            $('#group' + i).append('<td></td>');
        }

        if (userDisconnected) $('#group' + i).addClass("danger");
    }

    gameGroup = groups;

    if (numUsers == 1) {
        var numParticipants = "There is currently 1 participant.";
    } else {
        var numParticipants = 'There are currently ' + numUsers + ' participants.';
    }

    $('#status').text('You have not started the game. ' + numParticipants);
}

// Track which datasets are hidden by user
var hiddenDatasets = {};

// The details of the fancy charts
function drawChart(group, type) {
    var ctx = document.getElementById('groupChart').getContext('2d');
    
    var chartKey = group + '_' + type;
    
    // Store hidden state from current chart before destroying
    if (chart && chart.data && chart.data.datasets) {
        if (!hiddenDatasets[chartKey]) {
            hiddenDatasets[chartKey] = {};
        }
        for (var i = 0; i < chart.data.datasets.length; i++) {
            var meta = chart.getDatasetMeta(i);
            hiddenDatasets[chartKey][chart.data.datasets[i].label] = meta.hidden;
        }
    }
    
    if (chart && typeof chart.destroy === 'function') {
        chart.destroy();
    }

    var labels = [];
    for (var i = 1; i < gameGroup[group].week; i++) {
        labels.push(i);
    }

    var datasets = [];
    var vAxisTitle = "";
    switch (type) {
        case "Cost": vAxisTitle = "Cost ($)"; break;
        case "Inventory": vAxisTitle = "Inventory (units)"; break;
        case "Orders": vAxisTitle = "Orders (units)"; break;
    }

    var roleColors = [
        'rgba(54, 162, 235, 1)',   // Blue
        'rgba(75, 192, 192, 1)',   // Green
        'rgba(255, 159, 64, 1)',   // Orange
        'rgba(255, 99, 132, 1)'    // Red
    ];

    for (var j = 0; j < gameGroup[group].users.length; j++) {
        var userData = [];
        for (var i = 1; i < gameGroup[group].week; i++) {
            var val = 0;
            switch (type) {
                case "Cost":
                    val = gameGroup[group].users[j].costHistory[i];
                    break;
                case "Inventory":
                    val = parseInt(gameGroup[group].users[j].inventoryHistory[i]) - parseInt(gameGroup[group].users[j].backlogHistory[i]);
                    break;
                case "Orders":
                    val = gameGroup[group].users[j].orderHistory[i];
                    break;
            }
            userData.push(val);
        }

        var roleName = gameGroup[group].users[j].role.name;
        var isHidden = hiddenDatasets[chartKey] && hiddenDatasets[chartKey][roleName] === true;
        
        datasets.push({
            label: roleName,
            data: userData,
            borderColor: roleColors[j % roleColors.length],
            backgroundColor: roleColors[j % roleColors.length].replace('1)', '0.1)'),
            borderWidth: 2,
            fill: false,
            tension: 0.1,
            hidden: isHidden
        });
    }

    var chartTitle = "Group " + (parseInt(group) + 1) + " - " + type;

    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: chartTitle,
                    font: { size: 16 }
                },
                legend: {
                    position: 'bottom',
                    labels: { 
                        boxWidth: 12, 
                        padding: 20,
                        usePointStyle: true
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Week #'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: vAxisTitle
                    },
                    beginAtZero: true
                }
            }
        }
    });
}

// Populate the AI model options in the Add Team modal
function populateAiModelOptions() {
    var selects = ['#playerTypeRetailer', '#playerTypeWholesaler', '#playerTypeWarehouse', '#playerTypeFactory'];
    
    for (var i = 0; i < selects.length; i++) {
        var $select = $(selects[i]);
        // Clear existing options
        $select.empty();
        $select.append($("<option></option>").attr("value", "human").text("Human"));
        
        // Add AI model options
        for (var j = 0; j < aiModels.length; j++) {
            var modelName = aiModels[j];
            $select.append($("<option></option>").attr("value", modelName).text(modelName));
        }
    }
}