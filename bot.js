// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
var fs = require('fs');

const { ActionTypes, ActivityTypes, CardFactory } = require('botbuilder');
const { LuisRecognizer } = require('botbuilder-ai');
const {
    DialogSet,
    WaterfallDialog,
    NumberPrompt,
    TextPrompt
} = require('botbuilder-dialogs');

const LIST_PUBLIC_HOLIDAYS = `list_public_holidays`;
const LIST_FLEXIBLE_HOLIDAYS = 'list_flexible_holidays';
const LEAVE_REQUEST = 'leave_request';
const SUBMITTED_REQUESTS = 'submitted_requests';

const LAST_DAY_OF_YEAR = `2019-12-31`;
const START_DAY_OF_YEAR = `2019-01-01`;
const MAX_FLEXIBLE_LEAVES = 3;
const MAX_PLANNED_LEAVES = 27;

const USER_HOLIDAY_DATA = 'user_holiday_data';
const FLEXIBLE_DIALOG_STATE_ACCESSOR = 'flexible_dialog_state_accesor';
const FLEXIBLE_HOLIDAYS_DATA_ACCESOR = 'flexible_holidays_data_accesor';
const AVAILED_FLEXIBLE_DATE_PROMPT = 'availed_flexible_date_prompt';
const FLEXIBLE_DIALOG = 'flexible_dialog';
const LEAVES_DATA_ACCESOR = 'leaves_data_accesor';
const LEAVES_DIALOG_STATE_ACCESOR = 'leaves_dialog_state_accesor';
const REASON_FOR_LEAVE_PROMPT = 'reason_for_leave_prompt';
const LEAVE_REQUEST_DIALOG = 'leave_request_dialog';

class LuisBot {
    constructor(application, luisPredictionOptions, conversationState, userState) {
        this.leavesDialofStateAccesor = conversationState.createProperty(
            LEAVES_DIALOG_STATE_ACCESOR
        );
        this.flexibleDialogStateAccessor = conversationState.createProperty(
            FLEXIBLE_DIALOG_STATE_ACCESSOR
        );
        this.flexibleHolidaysDataAccesor = conversationState.createProperty(
            FLEXIBLE_HOLIDAYS_DATA_ACCESOR
        );
        this.leavesDataAccesor = conversationState.createProperty(
            LEAVES_DATA_ACCESOR
        );
        this.userHolidayDataAccesor = userState.createProperty(
            USER_HOLIDAY_DATA
        );

        this.conversationState = conversationState;
        this.userState = userState;
        this.luisRecognizer = new LuisRecognizer(
            application,
            luisPredictionOptions,
            true
        );

        this.flexibleDialogSet = new DialogSet(this.flexibleDialogStateAccessor);
        this.flexibleDialogSet.add(
            new NumberPrompt(AVAILED_FLEXIBLE_DATE_PROMPT)
        );
        this.flexibleDialogSet.add(
            new WaterfallDialog(FLEXIBLE_DIALOG, [
                this.promptForNumber.bind(this),
                this.acknowledgeAvailedMessage.bind(this)
            ])
        );
        this.leaveRequestDialogSet = new DialogSet(this.leavesDialofStateAccesor);
        this.leaveRequestDialogSet.add(
            new TextPrompt(REASON_FOR_LEAVE_PROMPT)
        );
        this.leaveRequestDialogSet.add(
            new WaterfallDialog(LEAVE_REQUEST_DIALOG, [
                this.promptForReason.bind(this),
                this.acknowledgeLeaveMessage.bind(this)
            ])
        );
    }
    async userInputValidator(stepContext) {
        return true;
    }

    async promptForReason(stepContext) {
        return await stepContext.prompt(REASON_FOR_LEAVE_PROMPT, {
            prompt: 'Reason behind these leaves?'
        });
    }

    async promptForNumber(stepContext) {
        console.log('In prompt for number');
        return await stepContext.prompt(AVAILED_FLEXIBLE_DATE_PROMPT, {
            prompt: 'Select to avail any flexible leave'
        });
    }

    async acknowledgeLeaveMessage(stepContext) {
        var reason = stepContext.result;
        var leavesList = await this.leavesDataAccesor.get(
            stepContext.context,
            null
        );
        var userHolidayList = await this.userHolidayDataAccesor.get(
            stepContext.context,
            { 'flexible': [], 'planned': [] }
        );
        for (var ind in leavesList) {
            var leave = leavesList[ind];
            leave.reason = reason;
        }
        var total_leaves = userHolidayList['planned'].concat(leavesList);
        if (total_leaves.length > MAX_PLANNED_LEAVES) {
            await stepContext.context.sendActivity(
                `You can only avail max of ${ MAX_PLANNED_LEAVES } planned holidays.`
            );
        } else {
            console.log('setting up');
            await this.userHolidayDataAccesor.set(stepContext.context, {
                'flexible': userHolidayList.flexible,
                'planned': total_leaves
            });
            await stepContext.context.sendActivity(
                'Planned leaves were granted and they got added to your total holidays.'
            );
        }
        await stepContext.endDialog();
    }

    async acknowledgeAvailedMessage(stepContext) {
        console.log('in acknowledgeAvailedMessage');
        console.log(stepContext.result);
        var holidaysList = await this.flexibleHolidaysDataAccesor.get(
            stepContext.context,
            null
        );
        console.log(holidaysList);
        var userHolidayList = await this.userHolidayDataAccesor.get(
            stepContext.context,
            null
        );
        console.log(userHolidayList);
        if (stepContext.result < holidaysList.length) {
            var selectedDay = holidaysList[parseInt(stepContext.result)];
            var flag = false;
            for (var i in userHolidayList.flexible) {
                if (userHolidayList.flexible[i].date === selectedDay.date) {
                    flag = true;
                    var datesList = [];
                    for (var ind in userHolidayList.flexible) {
                        datesList.push(userHolidayList.flexible[ind].date);
                    }
                    await stepContext.context.sendActivity(
                        `You have already availed this holiday. Your flexible holidays are on ${ datesList.join(' || ') } `
                    );
                    await stepContext.endDialog();
                    break;
                }
            }

            if (userHolidayList.flexible.length < MAX_FLEXIBLE_LEAVES && !flag) {
                userHolidayList.flexible.push(selectedDay);
                await this.userHolidayDataAccesor.set(stepContext.context, userHolidayList);
                var datesList = [];
                for (var ind in userHolidayList.flexible) {
                    datesList.push(userHolidayList.flexible[ind].date);
                }
                await stepContext.context.sendActivity(
                    `Availed this day as flexible holiday. Your flexible holidays are on ${ datesList.join(' || ') }`
                );
                await stepContext.endDialog();
            } else if (userHolidayList.flexible.length === 3 && !flag) {
                await stepContext.context.sendActivity(
                    'You already avail 3 flexible holidays'
                );
                await stepContext.endDialog();
            }
        }
    }

    /**
     *
     * @param {Object} context on turn context object.
     */
    async onTurn(turnContext) {
        // By checking the incoming Activity type, the bot only calls LUIS in appropriate cases.
        if (turnContext.activity.type === ActivityTypes.Message) {
            const fdc = await this.flexibleDialogSet.createContext(turnContext);
            const pdc = await this.leaveRequestDialogSet.createContext(turnContext);
            console.log('active dialog:' + fdc.activeDialog);
            var userHolidayList = await this.userHolidayDataAccesor.get(
                turnContext,
                { 'flexible': [], 'planned': [] }
            );

            // Perform a call to LUIS to retrieve results for the user's message.
            const results = await this.luisRecognizer.recognize(turnContext);

            // Since the LuisRecognizer was configured to include the raw results, get the `topScoringIntent` as specified by LUIS.
            const topIntent = results.luisResult.topScoringIntent;
            const entities = results.luisResult.entities;
            // const type = results.luisResult.entities[0].resolution;
            console.log(JSON.stringify(results.luisResult));

            var holidaysList = [];
            console.log(`topIntent.intent: ` + topIntent.intent);
            if (topIntent.intent === LIST_PUBLIC_HOLIDAYS) {
                await fdc.endDialog();
                await pdc.endDialog();
                if (results.luisResult.entities.length === 0) {
                    holidaysList = getUpcomingPublicHolidaysList('public-holidays');
                } else {
                    if (results.luisResult.entities[0].type === 'builtin.datetimeV2.daterange') {
                        var possible_values = results.luisResult.entities[0].resolution.values;
                        var ind = get_valid_values(possible_values);
                        holidaysList = (getUpcomingPublicHolidaysList('public-holidays',possible_values[ind].start, possible_values[ind].end));
                    } else if (results.luisResult.entities[0].type === 'builtin.datetimeV2.date') {
                        holidaysList = (getUpcomingPublicHolidaysList('public-holidays', results.luisResult.entities[0].resolution.values[1].date));
                    }
                }
                var card = createAdaptiveCard(holidaysList);
                // console.log(card);
                await turnContext.sendActivity(
                    {
                        attachments: [CardFactory.adaptiveCard(card)]
                    }
                );
            } else if (topIntent.intent === LIST_FLEXIBLE_HOLIDAYS) {
                await pdc.endDialog();
                const flexibleHolidaysData = await this.flexibleHolidaysDataAccesor.get(
                    turnContext,
                    null
                );

                if (!containsDateEntityType(entities)) {
                    holidaysList = getUpcomingPublicHolidaysList('flexible');
                } else {
                    if (results.luisResult.entities[0].type === 'builtin.datetimeV2.daterange') {
                        var possible_values = results.luisResult.entities[0].resolution.values;
                        var ind = get_valid_values(possible_values);
                        holidaysList = (getUpcomingPublicHolidaysList('flexible', possible_values[ind].start, possible_values[ind].end));
                    } else if (results.luisResult.entities[0].type === 'builtin.datetimeV2.date') {
                        holidaysList = (getUpcomingPublicHolidaysList('flexible', results.luisResult.entities[0].resolution.values[1].date));
                    }
                }
                var card = createHeroCard(holidaysList);
                await this.flexibleHolidaysDataAccesor.set(turnContext, holidaysList);
                var heroCard = CardFactory.heroCard(
                    'Flexible holidays',
                    undefined,
                    card,
                    {
                        text:
                            'Click on them to avail.'
                    }
                );
                // console.log(card);
                await turnContext.sendActivity(
                    {
                        type: ActivityTypes.Message,
                        attachments: [heroCard]
                    }
                );
                await fdc.beginDialog(FLEXIBLE_DIALOG);
            } else if (topIntent.intent === LEAVE_REQUEST) {
                await fdc.endDialog();
                await pdc.beginDialog(LEAVE_REQUEST_DIALOG);
                const leavesData = await this.leavesDataAccesor.get(
                    turnContext,
                    null
                );
                var leavesList = [];
                if (results.luisResult.entities.length === 0) {
                    leavesList = [];
                } else {
                    var possible_values = results.luisResult.entities[0].resolution.values;
                    if (results.luisResult.entities[0].type === 'builtin.datetimeV2.daterange') {
                        var ind = get_valid_values(possible_values);
                        leavesList = getLeavesBetweenDates(possible_values[ind].start, possible_values[ind].end, userHolidayList);
                    } else if (results.luisResult.entities[0].type === 'builtin.datetimeV2.date') {
                        console.log(`single date ${ JSON.stringify(possible_values) }`);
                        leavesList = getLeavesBetweenDates(possible_values[1].value, possible_values[1].value, userHolidayList);
                    }
                }
                await this.leavesDataAccesor.set(turnContext, leavesList);
            } else if (topIntent.intent === SUBMITTED_REQUESTS) {
                console.log(`In submitted requests`);
                if (find_entity(entities) === `flexible`) {
                    console.log(`In flexible entity`);
                    var user_flexible_holidays = get_holidays(userHolidayList.flexible, entities);
                    console.log(`flexible holidays: ${ JSON.stringify(user_flexible_holidays) }`);
                    var card = createAdaptiveCardForUserFlexible(user_flexible_holidays);
                    await turnContext.sendActivity(
                        {
                            attachments: [CardFactory.adaptiveCard(card)]
                        }
                    );
                } else if (find_entity(entities) === `planned`) {
                    console.log(`In planned entity`);
                    var user_planned_holidays = get_holidays(userHolidayList.planned, entities);
                    var card = createAdaptiveCardForUserPlanned(user_planned_holidays);
                    await turnContext.sendActivity(
                        {
                            attachments: [CardFactory.adaptiveCard(card)]
                        }
                    );
                    console.log(`planned holidays: ${ JSON.stringify(user_planned_holidays) }`);
                } else {
                    console.log(`In all entities`);
                    var user_flexible_holidays = get_holidays(userHolidayList.flexible, entities);
                    var user_planned_holidays = get_holidays(userHolidayList.planned, entities);
                    console.log(`flexible holidays: ${ JSON.stringify(user_flexible_holidays) }`);
                    console.log(`planned holidays: ${ JSON.stringify(user_planned_holidays) }`);
                    var card = createAdaptiveCardForUserFlexible(user_flexible_holidays);
                    await turnContext.sendActivity(
                        {
                            attachments: [CardFactory.adaptiveCard(card)]
                        }
                    );
                    var card = createAdaptiveCardForUserPlanned(user_planned_holidays);
                    await turnContext.sendActivity(
                        {
                            attachments: [CardFactory.adaptiveCard(card)]
                        }
                    );
                }
            } else {
                if (fdc.activeDialog) {
                    const dialogTurnResult = await fdc.continueDialog();
                }
                if (pdc.activeDialog) {
                    const dialogTurnResult = await pdc.continueDialog();
                }
            }
        } else if (
            turnContext.activity.type === ActivityTypes.ConversationUpdate &&
            turnContext.activity.recipient.id !==
            turnContext.activity.membersAdded[0].id
        ) {
            // If the Activity is a ConversationUpdate, send a greeting message to the user.
            await turnContext.sendActivity(
                'Welcome to the NLP with LUIS sample! Send me a message and I will try to predict your intent.'
            );
        } else if (
            turnContext.activity.type !== ActivityTypes.ConversationUpdate
        ) {
            // Respond to all other Activity types.
            await turnContext.sendActivity(
                `[${ turnContext.activity.type }]-type activity detected.`
            );
        }
        await this.conversationState.saveChanges(turnContext, false);
        await this.userState.saveChanges(turnContext, false);
        var go = await this.userHolidayDataAccesor.get(
            turnContext,
            null
        );
        console.log('Final data');
        if (go !== null) {
            console.log(go.flexible);
            console.log(go.planned);
        }
    }
}

var contents = fs.readFileSync('./holiday-calender.json');
var holidays = JSON.parse(contents);

function containsDateEntityType(entities){
    for (var ind in entities) {
        var entity = entities[ind];
        if (entity.type === 'builtin.datetimeV2.daterange' || entity.type === 'builtin.datetimeV2.date') {
            return true;
        }
    }
    return false;
}

function getUpcomingPublicHolidaysList(holiday_key, start_date = START_DAY_OF_YEAR, end_date = LAST_DAY_OF_YEAR) {
    var upcoming_holidays_list = [];
    var start_date = new Date(start_date);
    var end_date = new Date(end_date);

    public_holidays = holidays[holiday_key];

    for (var day in public_holidays) {
        public_holiday = public_holidays[day];
        cur_public_holiday_date = new Date(public_holiday["date"]);
        if (cur_public_holiday_date >= start_date && cur_public_holiday_date <= end_date){
            upcoming_holidays_list.push(public_holiday)
        }
    }
    return upcoming_holidays_list;
}

function find_entity(entities) {
    for (var ind in entities) {
        var entity = entities[ind];
        if (entity.type === `flexible`) {
            return `flexible`;
        }
        if (entity.type === `planned`) {
            return `planned`;
        }
    }
    return `None`;
}

function createAdaptiveCard(holidaysList) {
    // console.log(holidaysList);
    var contents = fs.readFileSync('./adap.json');
    var base_card = JSON.parse(contents);

    var contents = fs.readFileSync('./single_node.json');
    var node = JSON.parse(contents);

    // console.log(node.columns[0].items[0]['text']);
    // console.log('started');
    node.columns[0].items[0]['text'] = 'NO';
    for (var day in holidaysList ) {
        public_holiday = holidaysList[day];
        // console.log(public_holiday);
        node.columns[0].items[0]['text'] = public_holiday.date;
        node.columns[1].items[0]['text'] = public_holiday.reason;
        node.columns[2].items[0]['text'] = public_holiday.day;
        // console.log(public_holiday.date);
        base_card.body.push(JSON.parse(JSON.stringify(node)));
    }
    return base_card;
}

function createAdaptiveCardForUserFlexible(holidaysList) {
    // console.log(holidaysList);
    var contents = fs.readFileSync('./cards/user_flexible_leaves/user_flexible_leaves_adaptive_card.json');
    var base_card = JSON.parse(contents);

    var contents = fs.readFileSync('./cards/user_flexible_leaves/user_flexible_node.json');
    var node = JSON.parse(contents);

    // console.log(node.columns[0].items[0]['text']);
    // console.log('started');
    node.columns[0].items[0]['text'] = 'NO';
    for (var day in holidaysList) {
        public_holiday = holidaysList[day];
        // console.log(public_holiday);
        node.columns[0].items[0]['text'] = public_holiday.date;
        node.columns[1].items[0]['text'] = public_holiday.reason;
        // console.log(public_holiday.date);
        base_card.body.push(JSON.parse(JSON.stringify(node)));
    }
    return base_card;
}

function createAdaptiveCardForUserPlanned(holidaysList) {
    // console.log(holidaysList);
    var contents = fs.readFileSync('./cards/user_planned_leaves/user_planned_leaves_adaptive_card.json');
    var base_card = JSON.parse(contents);

    var contents = fs.readFileSync('./cards/user_planned_leaves/user_planned_node.json');
    var node = JSON.parse(contents);

    // console.log(node.columns[0].items[0]['text']);
    // console.log('started');
    node.columns[0].items[0]['text'] = 'NO';
    for (var day in holidaysList) {
        public_holiday = holidaysList[day];
        // console.log(public_holiday);
        node.columns[0].items[0]['text'] = public_holiday.date;
        node.columns[1].items[0]['text'] = public_holiday.reason;
        // console.log(public_holiday.date);
        base_card.body.push(JSON.parse(JSON.stringify(node)));
    }
    return base_card;
}

function createHeroCard(holidaysList){
    var base_card = [];
    for (var day in holidaysList ) {
        public_holiday = holidaysList[day];
        var node = {
            type: ActionTypes.ImBack,
            title: `${public_holiday.date} || ${public_holiday.reason} || ${public_holiday.day}` ,
            value: day
        };
        base_card.push(node);
    }
    return base_card;
}

function get_valid_values(possible_values) {
    for (var i in possible_values) {
        var cur_val = possible_values[i];
        if((cur_val.start !== undefined && cur_val.start.includes('2019')) || (cur_val.end !== undefined && cur_val.end.includes('2019'))){
            return i;
        }
    }
    return 0;
}

function get_holidays(userHolidayList, entities) {
    var total_holidays_list = [];
    var flag = false;
    for (var ind in entities) {
        var entity = entities[ind];
        console.log(`entity type: ${ entity.type }`);
        if (entity.type === `builtin.datetimeV2.daterange`) {
            flag = true;
            console.log(`In date range`);
            for (var i in entities.resolution.values) {
                var value = entities.resolution.values[i];
                total_holidays_list = total_holidays_list.concat(getUserLeavesBetweenDates(value.start, value.end, userHolidayList));
            }
        } else if (entity.type === `builtin.datetimeV2.date`) {
            flag = true;
            console.log(`In date`);
            for (var j in entities.resolution.values) {
                var value = entities.resolution.values[j];
                total_holidays_list = total_holidays_list.concat(getUserLeavesBetweenDates(value.value, value.value, userHolidayList));
            }
        }
    }
    if (!flag) {
        total_holidays_list = total_holidays_list.concat(getUserLeavesBetweenDates(START_DAY_OF_YEAR, LAST_DAY_OF_YEAR, userHolidayList));
    }
    return total_holidays_list;
}

function getUserLeavesBetweenDates(start_date = START_DAY_OF_YEAR, end_date = LAST_DAY_OF_YEAR, user_leaves_data) {
    console.log(`start date: ${ start_date }`);
    console.log(`end date: ${ end_date}`);
    console.log(`user leaved data: ${ JSON.stringify(user_leaves_data) }`);
    var leavesList = [];
    for (var i in user_leaves_data) {
        var user_leave = user_leaves_data[i];
        if (new Date(start_date) <= new Date(user_leave.date) && new Date(end_date) >= new Date(user_leave.date)) {
            leavesList.push(user_leave);
        }
    }
    console.log(`leaves list: ${ JSON.stringify(leavesList) }`);
    return leavesList;
}

function yyyy_mm_dd(date) {
    var mm = date.getMonth() + 1; // getMonth() is zero-based
    var dd = date.getDate();

    return [date.getFullYear(),
        (mm > 9 ? '' : '0') + mm,
        (dd > 9 ? '' : '0') + dd
    ].join('-');
}

function getLeavesBetweenDates(start_date, end_date, user_leaves_data) {
    console.log(`In getLeaves between`);
    console.log(user_leaves_data);
    var leavesRequestData = [];
    for (var d = new Date(start_date); d <= new Date(end_date); d.setDate(d.getDate() + 1)) {
        if (d.getDay() !== 6 && d.getDay() !== 0 && !alreadyContained(user_leaves_data, d)) {
            leavesRequestData.push(
                {
                    'date': yyyy_mm_dd(d),
                    'reason': 'reason'
                }
            );
        }
    }
    console.log(leavesRequestData);
    return leavesRequestData;
}

function alreadyContained(user_leaves_data, cur_date) {
    console.log(`In already contained`);
    console.log(`user leaves flexible ${ user_leaves_data.flexible }`);
    console.log(`user leaves planned ${ JSON.stringify(user_leaves_data.planned) }`);
    console.log(`cur_date ${ cur_date }`);
    var flexible_leaves= user_leaves_data['flexible'];
    var planned_leaves = user_leaves_data['planned'];
    var total_leaves = flexible_leaves.concat(planned_leaves);
    console.log(`total leaves: ${ JSON.stringify(total_leaves) }`);
    cur_date = new Date(cur_date);
    cur_date.setHours(0, 0, 0, 0);
    for (var day in total_leaves) {
        var date_seq = new Date(total_leaves[day].date);
        date_seq.setHours(0, 0, 0, 0);
        if (date_seq.valueOf() !== cur_date.valueOf()) {
        } else {
            console.log(`output of alreay contained: true`);
            return true;
        }
    }
    console.log(`output of alreay contained: false`);
    return false;
}

module.exports.MyBot = LuisBot;
