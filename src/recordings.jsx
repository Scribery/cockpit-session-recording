/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */
"use strict";

import React from "react";
import {
    Bullseye,
    Button,
    Card,
    CardBody,
    DataList,
    DataListCell,
    DataListItem,
    DataListItemCells,
    DataListItemRow,
    EmptyState,
    EmptyStateBody,
    EmptyStateIcon,
    EmptyStateVariant,
    ExpandableSection,
    Spinner,
    Title,
    TextInput,
    Toolbar,
    ToolbarContent,
    ToolbarItem,
    ToolbarGroup,
} from "@patternfly/react-core";
import {
    sortable,
    SortByDirection,
    Table,
    TableHeader,
    TableBody
} from "@patternfly/react-table";
import {
    AngleLeftIcon,
    CogIcon,
    ExclamationCircleIcon,
    ExclamationTriangleIcon,
    PlusIcon,
    SearchIcon
} from "@patternfly/react-icons";
import { global_danger_color_200 } from "@patternfly/react-tokens";

const $ = require("jquery");
const cockpit = require("cockpit");
const _ = cockpit.gettext;
const moment = require("moment");
const Journal = require("journal");
const Player = require("./player.jsx");
const Config = require("./config.jsx");

/*
 * Convert a number to integer number string and pad with zeroes to
 * specified width.
 */
const padInt = function (n, w) {
    const i = Math.floor(n);
    const a = Math.abs(i);
    let s = a.toString();
    for (w -= s.length; w > 0; w--) {
        s = '0' + s;
    }
    return ((i < 0) ? '-' : '') + s;
};

/*
 * Format date and time for a number of milliseconds since Epoch.
 */
const formatDateTime = function (ms) {
    return moment(ms).format("YYYY-MM-DD HH:mm:ss");
};

const formatDateTimeOffset = function (ms, offset) {
    return moment(ms).utcOffset(offset)
            .format("YYYY-MM-DD HH:mm:ss");
};

const formatUTC = function(date) {
    return moment(date).utc()
            .format("YYYY-MM-DD HH:mm:ss") + " UTC";
};

/*
 * Format a time interval from a number of milliseconds.
 */
const formatDuration = function (ms) {
    let v = Math.floor(ms / 1000);
    const s = Math.floor(v % 60);
    v = Math.floor(v / 60);
    const m = Math.floor(v % 60);
    v = Math.floor(v / 60);
    const h = Math.floor(v % 24);
    const d = Math.floor(v / 24);
    let str = '';

    if (d > 0) {
        str += d + ' ' + _("days") + ' ';
    }

    if (h > 0 || str.length > 0) {
        str += padInt(h, 2) + ':';
    }

    str += padInt(m, 2) + ':' + padInt(s, 2);

    return (ms < 0 ? '-' : '') + str;
};

function LogElement(props) {
    const entry = props.entry;
    const start = props.start;
    const cursor = entry.__CURSOR;
    const entry_timestamp = parseInt(entry.__REALTIME_TIMESTAMP / 1000);

    const timeClick = function(_e) {
        const ts = entry_timestamp - start;
        if (ts > 0) {
            props.jumpToTs(ts);
        } else {
            props.jumpToTs(0);
        }
    };
    const messageClick = () => {
        const url = '/system/logs#/' + cursor + '?parent_options={}';
        const win = window.open(url, '_blank');
        win.focus();
    };

    const cells = <DataListItemCells
                        dataListCells={[
                            <DataListCell key="row">
                                <ExclamationTriangleIcon />
                                <Button variant="link" onClick={timeClick}>
                                    {formatDateTime(entry_timestamp)}
                                </Button>
                                <Card isSelectable onClick={messageClick}>
                                    <CardBody>{entry.MESSAGE}</CardBody>
                                </Card>
                            </DataListCell>
                        ]} />;

    return (
        <DataListItem>
            <DataListItemRow>{cells}</DataListItemRow>
        </DataListItem>
    );
}

function LogsView(props) {
    const { entries, start, end } = props;
    const rows = entries.map((entry) =>
        <LogElement
            key={entry.__CURSOR}
            entry={entry}
            start={start}
            end={end}
            jumpToTs={props.jumpToTs} />
    );
    return (
        <DataList>{rows}</DataList>
    );
}

class Logs extends React.Component {
    constructor(props) {
        super(props);
        this.journalctlError = this.journalctlError.bind(this);
        this.journalctlIngest = this.journalctlIngest.bind(this);
        this.journalctlPrepend = this.journalctlPrepend.bind(this);
        this.getLogs = this.getLogs.bind(this);
        this.loadLater = this.loadLater.bind(this);
        this.loadForTs = this.loadForTs.bind(this);
        this.getServerTimeOffset = this.getServerTimeOffset.bind(this);
        this.journalCtl = null;
        this.entries = [];
        this.start = null;
        this.end = null;
        this.hostname = null;
        this.state = {
            serverTimeOffset: null,
            cursor: null,
            after: null,
            entries: [],
        };
    }

    getServerTimeOffset() {
        cockpit.spawn(["date", "+%s:%:z"], { err: "message" })
                .done((data) => {
                    this.setState({ serverTimeOffset: data.slice(data.indexOf(":") + 1) });
                })
                .fail((ex) => {
                    console.log("Couldn't calculate server time offset: " + cockpit.message(ex));
                });
    }

    journalctlError(error) {
        console.warn(cockpit.message(error));
    }

    journalctlIngest(entryList) {
        if (entryList.length > 0) {
            this.entries.push(...entryList);
            const after = this.entries[this.entries.length - 1].__CURSOR;
            this.setState({ entries: this.entries, after: after });
        }
    }

    journalctlPrepend(entryList) {
        entryList.push(...this.entries);
        this.setState({ entries: this.entries });
    }

    getLogs() {
        if (this.start != null && this.end != null) {
            if (this.journalCtl != null) {
                this.journalCtl.stop();
                this.journalCtl = null;
            }

            const matches = [];
            if (this.hostname) {
                matches.push("_HOSTNAME=" + this.hostname);
            }

            let start = null;
            let end = null;

            if (this.state.serverTimeOffset != null) {
                start = formatDateTimeOffset(this.start, this.state.serverTimeOffset);
                end = formatDateTimeOffset(this.end, this.state.serverTimeOffset);
            } else {
                start = formatDateTime(this.start);
                end = formatDateTime(this.end);
            }

            const options = {
                since: start,
                until: end,
                follow: false,
                count: "all",
                merge: true,
            };

            if (this.state.after != null) {
                options.after = this.state.after;
                delete options.since;
            }

            const self = this;
            this.journalCtl = Journal.journalctl(matches, options)
                    .fail(this.journalctlError)
                    .done(function(data) {
                        self.journalctlIngest(data);
                    });
        }
    }

    loadLater() {
        this.start = this.end;
        this.end = this.end + 3600;
        this.getLogs();
    }

    loadForTs(ts) {
        this.end = this.start + ts;
        this.getLogs();
    }

    componentDidMount() {
        this.getServerTimeOffset();
    }

    componentDidUpdate() {
        if (this.props.recording) {
            if (this.start === null && this.end === null) {
                this.end = this.props.recording.start + 3600;
                this.start = this.props.recording.start;
            }
            if (this.props.recording.hostname) {
                this.hostname = this.props.recording.hostname;
            }
            this.getLogs();
        }
        if (this.props.curTs) {
            const ts = this.props.curTs;
            this.loadForTs(ts);
        }
    }

    componentWillUnmount() {
        this.journalCtl.stop();
        this.setState({
            serverTimeOffset: null,
            cursor: null,
            after: null,
            entries: [],
        });
    }

    render() {
        const r = this.props.recording;
        if (r == null) {
            return (
                <Bullseye>
                    <EmptyState variant={EmptyStateVariant.small}>
                        <Spinner />
                        <Title headingLevel="h2" size="lg">
                            {_("Loading...")}
                        </Title>
                    </EmptyState>
                </Bullseye>
            );
        } else {
            return (
                <>
                    <LogsView
                        id="logs-view"
                        entries={this.state.entries}
                        start={this.props.recording.start}
                        end={this.props.recording.end}
                        jumpToTs={this.props.jumpToTs} />
                    <Bullseye>
                        <Button
                            variant="secondary"
                            icon={<PlusIcon />}
                            onClick={this.loadLater}>
                            {_("Load later entries")}
                        </Button>
                    </Bullseye>
                </>
            );
        }
    }
}

/*
 * A component representing a single recording view.
 * Properties:
 * - recording: either null for no recording data available yet, or a
 *              recording object, as created by the View below.
 */
class Recording extends React.Component {
    constructor(props) {
        super(props);
        this.goBackToList = this.goBackToList.bind(this);
        this.handleTsChange = this.handleTsChange.bind(this);
        this.handleLogTsChange = this.handleLogTsChange.bind(this);
        this.handleLogsClick = this.handleLogsClick.bind(this);
        this.handleLogsReset = this.handleLogsReset.bind(this);
        this.state = {
            curTs: null,
            logsTs: null,
            logsEnabled: false,
        };
    }

    handleTsChange(ts) {
        this.setState({ curTs: ts });
    }

    handleLogTsChange(ts) {
        this.setState({ logsTs: ts });
    }

    handleLogsClick() {
        this.setState({ logsEnabled: !this.state.logsEnabled });
    }

    handleLogsReset() {
        this.setState({ logsEnabled: false }, () => {
            this.setState({ logsEnabled: true });
        });
    }

    goBackToList() {
        if (cockpit.location.path[0]) {
            if ("search_rec" in cockpit.location.options) {
                delete cockpit.location.options.search_rec;
            }
            cockpit.location.go([], cockpit.location.options);
        } else {
            cockpit.location.go('/');
        }
    }

    render() {
        const r = this.props.recording;
        if (r == null) {
            return (
                <Bullseye>
                    <EmptyState variant={EmptyStateVariant.small}>
                        <Spinner />
                        <Title headingLevel="h2" size="lg">
                            {_("Loading...")}
                        </Title>
                    </EmptyState>
                </Bullseye>
            );
        } else {
            return (
                <>
                    <Button variant="link" icon={<AngleLeftIcon />} onClick={this.goBackToList}>
                        {_("Session Recording")}
                    </Button>
                    <Player.Player
                        ref="player"
                        matchList={this.props.recording.matchList}
                        logsTs={this.logsTs}
                        search={this.props.search}
                        onTsChange={this.handleTsChange}
                        recording={r}
                        logsEnabled={this.state.logsEnabled}
                        onRewindStart={this.handleLogsReset} />
                    <ExpandableSection
                        id="btn-logs-view"
                        toggleText={_("Logs View")}
                        onToggle={this.handleLogsClick}
                        isExpanded={this.state.logsEnabled === true}>
                        <Logs
                            recording={this.props.recording}
                            curTs={this.state.curTs}
                            jumpToTs={this.handleLogTsChange} />
                    </ExpandableSection>
                </>
            );
        }
    }
}

/*
 * A component representing a list of recordings.
 * Properties:
 * - list: an array with recording objects, as created by the View below
 */
class RecordingList extends React.Component {
    constructor(props) {
        super(props);

        this.onSort = this.onSort.bind(this);
        this.rowClickHandler = this.rowClickHandler.bind(this);
        this.state = {
            sortBy: {
                index: 1,
                direction: SortByDirection.asc
            }
        };
    }

    onSort(_event, index, direction) {
        this.setState({
            sortBy: {
                index,
                direction
            },
        });
    }

    rowClickHandler(_event, row) {
        cockpit.location.go([row.id], cockpit.location.options);
    }

    render() {
        const { sortBy } = this.state;
        const { index, direction } = sortBy;

        // generate columns
        let titles = ["User", "Start", "End", "Duration"];
        if (this.props.diff_hosts === true)
            titles.push("Hostname");
        const columnTitles = titles.map(title => ({
            title: _(title),
            transforms: [sortable]
        }));

        // sort rows
        let rows = this.props.list.map(rec => {
            let cells = [
                rec.user,
                formatDateTime(rec.start),
                formatDateTime(rec.end),
                formatDuration(rec.end - rec.start),
            ];
            if (this.props.diff_hosts === true)
                cells.push(rec.hostname);
            return {
                id: rec.id,
                cells: cells
            };
        }).sort((a, b) => a.cells[index].localeCompare(b.cells[index]));
        rows = direction === SortByDirection.asc ? rows : rows.reverse();

        return (
            <>
                <Table
                    aria-label={_("Recordings")}
                    cells={columnTitles}
                    rows={rows}
                    sortBy={sortBy}
                    onSort={this.onSort}>
                    <TableHeader />
                    <TableBody onRowClick={this.rowClickHandler} />
                </Table>
                {!rows.length &&
                    <EmptyState variant={EmptyStateVariant.small}>
                        <EmptyStateIcon icon={SearchIcon} />
                        <Title headingLevel="h2" size="lg">
                            {_("No recordings found")}
                        </Title>
                        <EmptyStateBody>
                            {_("No recordings matched the filter criteria.")}
                        </EmptyStateBody>
                    </EmptyState>}
            </>
        );
    }
}

/*
 * A component representing the view upon a list of recordings, or a
 * single recording. Extracts the ID of the recording to display from
 * cockpit.location.path[0]. If it's zero, displays the list.
 */
export default class View extends React.Component {
    constructor(props) {
        super(props);
        this.onLocationChanged = this.onLocationChanged.bind(this);
        this.journalctlIngest = this.journalctlIngest.bind(this);
        this.handleInputChange = this.handleInputChange.bind(this);
        this.openConfig = this.openConfig.bind(this);
        /* Journalctl instance */
        this.journalctl = null;
        /* Recording ID journalctl instance is invoked with */
        this.journalctlRecordingID = null;
        /* Recording ID -> data map */
        this.recordingMap = {};
        /* tlog UID in system set in ComponentDidMount */
        this.uid = null;
        const path = cockpit.location.path[0];
        this.state = {
            /* List of recordings in start order */
            recordingList: [],
            /* ID of the recording to display, or null for all */
            recordingID: path === "config" ? null : path || null,
            /* filter values start */
            date_since: cockpit.location.options.date_since || "",
            date_until: cockpit.location.options.date_until || "",
            username: cockpit.location.options.username || "",
            hostname: cockpit.location.options.hostname || "",
            search: cockpit.location.options.search || "",
            /* filter values end */
            error_tlog_uid: false,
            diff_hosts: false,
            /* if config is open */
            config: path === "config",
        };
    }

    /*
     * Display a journalctl error
     */
    journalctlError(error) {
        console.warn(cockpit.message(error));
    }

    /*
     * Respond to cockpit location change by extracting and setting the
     * displayed recording ID.
     */
    onLocationChanged() {
        const path = cockpit.location.path[0];
        if (path === "config")
            this.setState({ config: true });
        else
            this.setState({
                recordingID: cockpit.location.path[0] || null,
                date_since: cockpit.location.options.date_since || "",
                date_until: cockpit.location.options.date_until || "",
                username: cockpit.location.options.username || "",
                hostname: cockpit.location.options.hostname || "",
                search: cockpit.location.options.search || "",
                config: false
            });
    }

    /*
     * Ingest journal entries sent by journalctl.
     */
    journalctlIngest(entryList) {
        const recordingList = this.state.recordingList.slice();
        let i;
        let j;
        let hostname;

        if (entryList[0]) {
            if (entryList[0]._HOSTNAME) {
                hostname = entryList[0]._HOSTNAME;
            }
        }

        for (i = 0; i < entryList.length; i++) {
            const e = entryList[i];
            const id = e.TLOG_REC;

            /* Skip entries with missing recording ID */
            if (id === undefined) {
                continue;
            }

            const ts = Math.floor(
                parseInt(e.__REALTIME_TIMESTAMP, 10) /
                            1000);

            let r = this.recordingMap[id];
            /* If no recording found */
            if (r === undefined) {
                /* Create new recording */
                if (hostname !== e._HOSTNAME) {
                    this.setState({ diff_hosts: true });
                }

                r = {
                    id:            id,
                    matchList:     ["TLOG_REC=" + id],
                    user:          e.TLOG_USER,
                    boot_id:       e._BOOT_ID,
                    session_id:    parseInt(e.TLOG_SESSION, 10),
                    pid:           parseInt(e._PID, 10),
                    start:         ts,
                    /* FIXME Should be start + message duration */
                    end:       ts,
                    hostname:  e._HOSTNAME,
                    duration:  0
                };
                /* Map the recording */
                this.recordingMap[id] = r;
                /* Insert the recording in order */
                for (j = recordingList.length - 1;
                    j >= 0 && r.start < recordingList[j].start;
                    j--);
                recordingList.splice(j + 1, 0, r);
            } else {
                /* Adjust existing recording */
                if (ts > r.end) {
                    r.end = ts;
                    r.duration = r.end - r.start;
                }
                if (ts < r.start) {
                    r.start = ts;
                    r.duration = r.end - r.start;
                    /* Find the recording in the list */
                    for (j = recordingList.length - 1;
                        j >= 0 && recordingList[j] != r;
                        j--);
                    /* If found */
                    if (j >= 0) {
                        /* Remove */
                        recordingList.splice(j, 1);
                    }
                    /* Insert the recording in order */
                    for (j = recordingList.length - 1;
                        j >= 0 && r.start < recordingList[j].start;
                        j--);
                    recordingList.splice(j + 1, 0, r);
                }
            }
        }

        this.setState({ recordingList: recordingList });
    }

    /*
     * Start journalctl, retrieving entries for the current recording ID.
     * Assumes journalctl is not running.
     */
    journalctlStart() {
        const matches = ["_COMM=tlog-rec",
            /* Strings longer than TASK_COMM_LEN (16) characters
             * are truncated (man proc) */
            "_COMM=tlog-rec-sessio"];

        if (this.state.username && this.state.username !== "") {
            matches.push("TLOG_USER=" + this.state.username);
        }
        if (this.state.hostname && this.state.hostname !== "") {
            matches.push("_HOSTNAME=" + this.state.hostname);
        }

        const options = { follow: false, count: "all", merge: true };

        if (this.state.date_since && this.state.date_since !== "") {
            options.since = formatUTC(this.state.date_since);
        }

        if (this.state.date_until && this.state.date_until !== "") {
            options.until = formatUTC(this.state.date_until);
        }

        if (this.state.search && this.state.search !== "" && this.state.recordingID === null) {
            options.grep = this.state.search;
        }

        if (this.state.recordingID !== null) {
            delete options.grep;
            matches.push("TLOG_REC=" + this.state.recordingID);
        }

        this.journalctlRecordingID = this.state.recordingID;
        this.journalctl = Journal.journalctl(matches, options)
                .fail(this.journalctlError)
                .stream(this.journalctlIngest);
    }

    /*
     * Check if journalctl is running.
     */
    journalctlIsRunning() {
        return this.journalctl != null;
    }

    /*
     * Stop current journalctl.
     * Assumes journalctl is running.
     */
    journalctlStop() {
        this.journalctl.stop();
        this.journalctl = null;
    }

    /*
     * Restarts journalctl.
     * Will stop journalctl if it's running.
     */
    journalctlRestart() {
        if (this.journalctlIsRunning()) {
            this.journalctl.stop();
        }
        this.journalctlStart();
    }

    /*
     * Clears previous recordings list.
     * Will clear service obj recordingMap and state.
     */
    clearRecordings() {
        this.recordingMap = {};
        this.setState({ recordingList: [] });
    }

    handleInputChange(name, value) {
        const state = {};
        state[name] = value;
        this.setState(state);
        cockpit.location.go([], $.extend(cockpit.location.options, state));
    }

    openConfig() {
        cockpit.location.go("/config");
    }

    componentDidMount() {
        const proc = cockpit.spawn(["getent", "passwd", "tlog"]);

        proc.stream((data) => {
            this.uid = data.split(":", 3)[2];
            this.journalctlStart();
            proc.close();
        });

        proc.fail(() => {
            this.setState({ error_tlog_uid: true });
        });

        cockpit.addEventListener("locationchanged",
                                 this.onLocationChanged);
    }

    componentWillUnmount() {
        if (this.journalctlIsRunning()) {
            this.journalctlStop();
        }
    }

    componentDidUpdate(_prevProps, prevState) {
        /*
         * If we're running a specific (non-wildcard) journalctl
         * and recording ID has changed
         */
        if (this.journalctlRecordingID !== null &&
            this.state.recordingID !== prevState.recordingID) {
            if (this.journalctlIsRunning()) {
                this.journalctlStop();
            }
            this.journalctlStart();
        }
        if (this.state.date_since !== prevState.date_since ||
            this.state.date_until !== prevState.date_until ||
            this.state.username !== prevState.username ||
            this.state.hostname !== prevState.hostname ||
            this.state.search !== prevState.search
        ) {
            this.clearRecordings();
            this.journalctlRestart();
        }
    }

    render() {
        if (this.state.config === true) {
            return <Config.Config />;
        } else if (this.state.error_tlog_uid === true) {
            return (
                <Bullseye>
                    <EmptyState variant={EmptyStateVariant.small}>
                        <EmptyStateIcon
                            icon={ExclamationCircleIcon}
                            color={global_danger_color_200.value} />
                        <Title headingLevel="h2" size="lg">
                            {_("Error")}
                        </Title>
                        <EmptyStateBody>
                            {_("Unable to retrieve tlog UID from system.")}
                        </EmptyStateBody>
                    </EmptyState>
                </Bullseye>
            );
        } else if (this.state.recordingID === null) {
            const toolbar = (
                <ToolbarContent>
                    <ToolbarGroup>
                        <ToolbarItem variant="label">{_("Since")}</ToolbarItem>
                        <ToolbarItem>
                            <TextInput
                                id="filter-since"
                                placeholder={_("Filter since")}
                                value={this.state.date_since}
                                type="search"
                                onChange={value => this.handleInputChange("date_since", value)} />
                        </ToolbarItem>
                    </ToolbarGroup>
                    <ToolbarGroup>
                        <ToolbarItem variant="label">{_("Until")}</ToolbarItem>
                        <ToolbarItem>
                            <TextInput
                                id="filter-until"
                                placeholder={_("Filter until")}
                                value={this.state.date_until}
                                type="search"
                                onChange={value => this.handleInputChange("date_until", value)} />
                        </ToolbarItem>
                    </ToolbarGroup>
                    <ToolbarGroup>
                        <ToolbarItem variant="label">{_("Search")}</ToolbarItem>
                        <ToolbarItem>
                            <TextInput
                                id="filter-search"
                                placeholder={_("Filter by content")}
                                value={this.state.search}
                                type="search"
                                onChange={value => this.handleInputChange("search", value)} />
                        </ToolbarItem>
                    </ToolbarGroup>
                    <ToolbarGroup>
                        <ToolbarItem variant="label">{_("Username")}</ToolbarItem>
                        <ToolbarItem>
                            <TextInput
                                id="filter-username"
                                placeholder={_("Filter by username")}
                                value={this.state.username}
                                type="search"
                                onChange={value => this.handleInputChange("username", value)} />
                        </ToolbarItem>
                    </ToolbarGroup>
                    {this.state.diff_hosts === true &&
                    <ToolbarGroup>
                        <ToolbarItem variant="label">{_("Hostname")}</ToolbarItem>
                        <ToolbarItem>
                            <TextInput
                                id="filter-hostname"
                                placeholder={_("Filter by hostname")}
                                value={this.state.hostname}
                                type="search"
                                onChange={value => this.handleInputChange("hostname", value)} />
                        </ToolbarItem>
                    </ToolbarGroup>}
                    <ToolbarItem>
                        <Button id="btn-config" onClick={this.openConfig}>
                            <CogIcon />
                        </Button>
                    </ToolbarItem>
                </ToolbarContent>
            );

            return (
                <>
                    <Toolbar>{toolbar}</Toolbar>
                    <RecordingList
                        date_since={this.state.date_since}
                        date_until={this.state.date_until}
                        username={this.state.username}
                        hostname={this.state.hostname}
                        list={this.state.recordingList}
                        diff_hosts={this.state.diff_hosts} />
                </>
            );
        } else {
            return (
                <Recording
                    recording={this.recordingMap[this.state.recordingID]}
                    search={this.state.search} />
            );
        }
    }
}
