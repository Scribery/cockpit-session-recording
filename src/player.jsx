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
import React from 'react';
import './player.css';
import { Terminal as Term } from 'xterm';
import {
    Alert,
    AlertGroup,
    Button,
    Chip,
    ChipGroup,
    DataList,
    DataListCell,
    DataListItem,
    DataListItemCells,
    DataListItemRow,
    ExpandableSection,
    InputGroup,
    Progress,
    TextInput,
    Toolbar,
    ToolbarContent,
    ToolbarItem,
    ToolbarGroup,
} from '@patternfly/react-core';
import {
    ArrowRightIcon,
    ExpandIcon,
    PauseIcon,
    PlayIcon,
    RedoIcon,
    SearchMinusIcon,
    SearchPlusIcon,
    SearchIcon,
    MinusIcon,
    UndoIcon,
    ThumbtackIcon,
    MigrationIcon,
} from '@patternfly/react-icons';

import cockpit from 'cockpit';
import { journal } from 'journal';

const _ = cockpit.gettext;
const $ = require("jquery");

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
 * YYYY-MM-DD HH:mm:ss
 */
const formatDateTime = function (ms) {
    /* Convert local timezone offset */
    const t = new Date(ms);
    const z = t.getTimezoneOffset() * 60 * 1000;
    let tLocal = t - z;
    tLocal = new Date(tLocal);
    let iso = tLocal.toISOString();

    /* cleanup ISO format */
    iso = iso.slice(0, 19);
    iso = iso.replace('T', ' ');
    return iso;
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

const scrollToBottom = function(id) {
    const el = document.getElementById(id);
    if (el) {
        el.scrollTop = el.scrollHeight;
    }
};

function ErrorList(props) {
    let list = [];

    if (props.list) {
        list = props.list.map((message, key) => { return <ErrorItem key={key} message={message} /> });
    }

    return (
        <AlertGroup>
            {list}
        </AlertGroup>
    );
}

function ErrorItem(props) {
    return (
        <Alert variant="danger" isInline>
            {props.message}
        </Alert>
    );
}

const ErrorService = class {
    constructor() {
        this.addMessage = this.addMessage.bind(this);
        this.errors = [];
    }

    addMessage(message) {
        if (typeof message === "object" && message !== null) {
            if ("toString" in message) {
                message = message.toString();
            } else {
                message = _("unknown error");
            }
        }
        if (typeof message === "string" || message instanceof String) {
            if (this.errors.indexOf(message) === -1) {
                this.errors.push(message);
            }
        }
    }
};

/*
 * An auto-loading buffer of recording's packets.
 */
const PacketBuffer = class {
    /*
     * Initialize a buffer.
     */
    constructor(matchList, reportError) {
        this.handleError = this.handleError.bind(this);
        this.handleStream = this.handleStream.bind(this);
        this.handleDone = this.handleDone.bind(this);
        this.getValidField = this.getValidField.bind(this);
        /* RegExp used to parse message's timing field */
        this.timingRE = new RegExp(
            /* Delay (1) */
            "\\+(\\d+)|" +
                                /* Text input (2) */
                                "<(\\d+)|" +
                                /* Binary input (3, 4) */
                                "\\[(\\d+)/(\\d+)|" +
                                /* Text output (5) */
                                ">(\\d+)|" +
                                /* Binary output (6, 7) */
                                "\\](\\d+)/(\\d+)|" +
                                /* Window (8, 9) */
                                "=(\\d+)x(\\d+)|" +
                                /* End of string */
                                "$",
            /* Continue after the last match only */
            /* FIXME Support likely sparse */
            "y"
        );
        /* List of matches to apply when loading the buffer from Journal */
        this.matchList = matchList;
        this.reportError = reportError;
        /*
         * An array of two-element arrays (tuples) each containing a
         * packet index and a deferred object. The list is kept sorted to
         * have tuples with lower packet indices first. Once the buffer
         * receives a packet at the specified index, the matching tuple is
         * removed from the list, and its deferred object is resolved.
         * This is used to keep users informed about packets arriving.
         */
        this.idxDfdList = [];
        /* Last seen message ID */
        this.id = 0;
        /* Last seen time position */
        this.pos = 0;
        /* Last seen window width */
        this.width = null;
        /* Last seen window height */
        this.height = null;
        /* List of packets read */
        this.pktList = [];
        /* Error which stopped the loading */
        this.error = null;
        /* The journalctl reading the recording */
        this.journalctl = journal.journalctl(
            this.matchList,
            { count: "all", follow: false, merge: true });
        this.journalctl.fail(this.handleError);
        this.journalctl.stream(this.handleStream);
        this.journalctl.done(this.handleDone);
        /*
         * Last seen cursor of the first, non-follow, journalctl run.
         * Null if no entry was received yet, or the second run has
         * skipped the entry received last by the first run.
         */
        this.cursor = null;
        /* True if the first, non-follow, journalctl run has completed */
        this.done = false;
    }

    /*
     * Get an object field, verifying its presence and type.
     */
    getValidField(object, field, type) {
        if (!(field in object)) {
            this.reportError("\"" + field + "\" field is missing");
        }
        const value = object[field];
        if (typeof (value) != typeof (type)) {
            this.reportError("invalid \"" + field + "\" field type: " + typeof (value));
        }
        return value;
    }

    /*
     * Return a promise which is resolved when a packet at a particular
     * index is received by the buffer. The promise is rejected with a
     * non-null argument if an error occurs or has occurred previously.
     * The promise is rejected with null, when the buffer is stopped. If
     * the packet index is not specified, assume it's the next packet.
     */
    awaitPacket(idx) {
        let i;
        let idxDfd;

        /* If an error has occurred previously */
        if (this.error !== null) {
            /* Reject immediately */
            return $.Deferred().reject(this.error)
                    .promise();
        }

        /* If the buffer was stopped */
        if (this.journalctl === null) {
            return $.Deferred().reject(null)
                    .promise();
        }

        /* If packet index is not specified */
        if (idx === undefined) {
            /* Assume it's the next one */
            idx = this.pktList.length;
        } else {
            /* If it has already been received */
            if (idx < this.pktList.length) {
                /* Return resolved promise */
                return $.Deferred().resolve()
                        .promise();
            }
        }

        /* Try to find an existing, matching tuple */
        for (i = 0; i < this.idxDfdList.length; i++) {
            idxDfd = this.idxDfdList[i];
            if (idxDfd[0] === idx) {
                return idxDfd[1].promise();
            } else if (idxDfd[0] > idx) {
                break;
            }
        }

        /* Not found, create and insert a new tuple */
        idxDfd = [idx, $.Deferred()];
        this.idxDfdList.splice(i, 0, idxDfd);

        /* Return its promise */
        return idxDfd[1].promise();
    }

    /*
     * Return true if the buffer was done loading everything logged to
     * journal so far and is now waiting for and loading new entries.
     * Return false if the buffer is loading existing entries so far.
     */
    isDone() {
        return this.done;
    }

    /*
     * Stop receiving the entries
     */
    stop() {
        if (this.journalctl === null) {
            return;
        }
        /* Destroy journalctl */
        this.journalctl.stop();
        this.journalctl = null;
        /* Notify everyone we stopped */
        for (let i = 0; i < this.idxDfdList.length; i++) {
            this.idxDfdList[i][1].reject(null);
        }
        this.idxDfdList = [];
    }

    /*
     * Add a packet to the received packet list.
     */
    addPacket(pkt) {
        /* TODO Validate the packet */
        /* Add the packet */
        this.pktList.push(pkt);
        /* Notify any matching listeners */
        while (this.idxDfdList.length > 0) {
            const idxDfd = this.idxDfdList[0];
            if (idxDfd[0] < this.pktList.length) {
                this.idxDfdList.shift();
                idxDfd[1].resolve();
            } else {
                break;
            }
        }
    }

    /*
     * Handle an error.
     */
    handleError(error) {
        /* Remember the error */
        this.error = error;
        /* Destroy journalctl, don't try to recover */
        if (this.journalctl !== null) {
            this.journalctl.stop();
            this.journalctl = null;
        }
        /* Notify everyone we had an error */
        for (let i = 0; i < this.idxDfdList.length; i++) {
            this.idxDfdList[i][1].reject(error);
        }
        this.idxDfdList = [];
        this.reportError(error);
    }

    /*
     * Parse packets out of a tlog message data and add them to the buffer.
     */
    parseMessageData(timing, in_txt, out_txt) {
        let matches;
        let in_txt_pos = 0;
        let out_txt_pos = 0;
        let t;
        let x;
        let y;
        let s;
        let io = [];
        let is_output;

        /* While matching entries in timing */
        this.timingRE.lastIndex = 0;
        for (;;) {
            /* Match next timing entry */
            matches = this.timingRE.exec(timing);
            if (matches === null) {
                this.reportError(_("invalid timing string"));
            } else if (matches[0] === "") {
                break;
            }

            /* Switch on entry type character */
            switch (t = matches[0][0]) {
            /* Delay */
            case "+":
                x = parseInt(matches[1], 10);
                if (x === 0) {
                    break;
                }
                if (io.length > 0) {
                    this.addPacket({
                        pos: this.pos,
                        is_io: true,
                        is_output,
                        io: io.join()
                    });
                    io = [];
                }
                this.pos += x;
                break;
                /* Text or binary input */
            case "<":
            case "[":
                x = parseInt(matches[(t === "<") ? 2 : 3], 10);
                if (x === 0) {
                    break;
                }
                if (io.length > 0 && is_output) {
                    this.addPacket({
                        pos: this.pos,
                        is_io: true,
                        is_output,
                        io: io.join()
                    });
                    io = [];
                }
                is_output = false;
                /* Add (replacement) input characters */
                s = in_txt.slice(in_txt_pos, in_txt_pos += x);
                if (s.length !== x) {
                    this.reportError(_("timing entry out of input bounds"));
                }
                io.push(s);
                break;
                /* Text or binary output */
            case ">":
            case "]":
                x = parseInt(matches[(t === ">") ? 5 : 6], 10);
                if (x === 0) {
                    break;
                }
                if (io.length > 0 && !is_output) {
                    this.addPacket({
                        pos: this.pos,
                        is_io: true,
                        is_output,
                        io: io.join()
                    });
                    io = [];
                }
                is_output = true;
                /* Add (replacement) output characters */
                s = out_txt.slice(out_txt_pos, out_txt_pos += x);
                if (s.length !== x) {
                    this.reportError(_("timing entry out of output bounds"));
                }
                io.push(s);
                break;
                /* Window */
            case "=":
                x = parseInt(matches[8], 10);
                y = parseInt(matches[9], 10);
                if (x === this.width && y === this.height) {
                    break;
                }
                if (io.length > 0) {
                    this.addPacket({
                        pos: this.pos,
                        is_io: true,
                        is_output,
                        io: io.join()
                    });
                    io = [];
                }
                this.addPacket({
                    pos: this.pos,
                    is_io: false,
                    width: x,
                    height: y
                });
                this.width = x;
                this.height = y;
                break;
            default:
                // continue
                break;
            }
        }

        if (in_txt_pos < [...in_txt].length) {
            this.reportError(_("extra input present"));
        }
        if (out_txt_pos < [...out_txt].length) {
            this.reportError(_("extra output present"));
        }

        if (io.length > 0) {
            this.addPacket({
                pos: this.pos,
                is_io: true,
                is_output,
                io: io.join()
            });
        }
    }

    /*
     * Parse packets out of a tlog message and add them to the buffer.
     */
    parseMessage(message) {
        const number = Number();
        const string = String();

        /* Check version */
        const ver = this.getValidField(message, "ver", string);
        const matches = ver.match("^(\\d+)\\.(\\d+)$");
        if (matches === null || matches[1] > 2) {
            this.reportError("\"ver\" field has invalid value: " + ver);
        }

        /* TODO Perhaps check host, rec, user, term, and session fields */

        /* Extract message ID */
        const id = this.getValidField(message, "id", number);
        if (id <= this.id) {
            this.reportError("out of order \"id\" field value: " + id);
        }

        /* Extract message time position */
        const pos = this.getValidField(message, "pos", number);
        if (pos < this.message_pos) {
            this.reportError("out of order \"pos\" field value: " + pos);
        }

        /* Update last received message ID and time position */
        this.id = id;
        this.pos = pos;

        /* Parse message data */
        this.parseMessageData(
            this.getValidField(message, "timing", string),
            this.getValidField(message, "in_txt", string),
            this.getValidField(message, "out_txt", string));
    }

    /*
     * Handle journalctl "stream" event.
     */
    handleStream(entryList) {
        let i;
        let e;
        for (i = 0; i < entryList.length; i++) {
            e = entryList[i];
            /* If this is the second, "follow", run */
            if (this.done) {
                /* Skip the last entry we added on the first run */
                if (this.cursor !== null) {
                    this.cursor = null;
                    continue;
                }
            } else {
                if (!('__CURSOR' in e)) {
                    this.handleError("No cursor in a Journal entry");
                }
                this.cursor = e.__CURSOR;
            }
            /* TODO Refer to entry number/cursor in errors */
            if (!('MESSAGE' in e)) {
                this.handleError("No message in Journal entry");
            }
            /* Parse the entry message */
            try {
                const utf8decoder = new TextDecoder();

                /* Journalctl stores fields with non-printable characters
                 * in an array of raw bytes formatted as unsigned
                 * integers */
                if (Array.isArray(e.MESSAGE)) {
                    const u8arr = new Uint8Array(e.MESSAGE);
                    this.parseMessage(JSON.parse(utf8decoder.decode(u8arr)));
                } else {
                    this.parseMessage(JSON.parse(e.MESSAGE));
                }
            } catch (error) {
                this.handleError(error);
                return;
            }
        }
    }

    /*
     * Handle journalctl "done" event.
     */
    handleDone() {
        this.done = true;
        if (this.journalctl !== null) {
            this.journalctl.stop();
            this.journalctl = null;
        }
        /* Continue with the "following" run  */
        this.journalctl = journal.journalctl(
            this.matchList,
            {
                cursor: this.cursor, follow: true, merge: true, count: "all"
            });
        this.journalctl.fail(this.handleError);
        this.journalctl.stream(this.handleStream);
        /* NOTE: no "done" handler on purpose */
    }
};

function SearchEntry(props) {
    return (
        <span className="search-result"><a href="#search-result" onClick={(e) => props.fastForwardToTS(props.pos, e)}>{formatDuration(props.pos)}</a></span>
    );
}

class Search extends React.Component {
    constructor(props) {
        super(props);
        this.handleInputChange = this.handleInputChange.bind(this);
        this.handleStream = this.handleStream.bind(this);
        this.handleError = this.handleError.bind(this);
        this.handleSearchSubmit = this.handleSearchSubmit.bind(this);
        this.handleClearSearchResults = this.handleClearSearchResults.bind(this);

        this.state = {
            search: cockpit.location.options.search_rec || cockpit.location.options.search || "",
        };
    }

    handleInputChange(name, value) {
        const state = {};
        state[name] = value;
        this.setState(state);
        cockpit.location.go(cockpit.location.path[0], $.extend(cockpit.location.options, { search_rec: value }));
    }

    handleSearchSubmit() {
        this.journalctl = journal.journalctl(
            this.props.matchList,
            { count: "all", follow: false, merge: true, grep: this.state.search });
        this.journalctl.fail(this.handleError);
        this.journalctl.stream(this.handleStream);
    }

    handleStream(data) {
        let items = data.map(item => {
            return JSON.parse(item.MESSAGE);
        });
        items = items.map(item => {
            return (
                <SearchEntry
                    key={item.id}
                    fastForwardToTS={this.props.fastForwardToTS}
                    pos={item.pos}
                />
            );
        });
        this.setState({ items });
    }

    handleError(data) {
        this.props.errorService.addMessage(data);
    }

    handleClearSearchResults() {
        delete cockpit.location.options.search;
        cockpit.location.go(cockpit.location.path[0], cockpit.location.options);
        this.setState({ search: "" });
        this.handleStream([]);
    }

    componentDidMount() {
        if (this.state.search) {
            this.handleSearchSubmit();
        }
    }

    render() {
        return (
            <ToolbarItem>
                <InputGroup>
                    <TextInput
                        id="search_rec"
                        type="search"
                        value={this.state.search}
                        onChange={(_event, value) => this.handleInputChange("search", value)}
                    />
                    <Button
                        variant="control"
                        onClick={this.handleSearchSubmit}
                    >
                        <SearchIcon />
                    </Button>
                    <Button
                        variant="control"
                        onClick={this.handleClearSearchResults}
                    >
                        <MinusIcon />
                    </Button>
                </InputGroup>
                <ToolbarItem>
                    {this.state.items}
                </ToolbarItem>
            </ToolbarItem>
        );
    }
}

class InputPlayer extends React.Component {
    render() {
        const input = String(this.props.input).replace(/(?:\r\n|\r|\n)/g, " ");

        return (
            <textarea name="input" id="input-textarea" cols="30" rows="1" value={input} readOnly disabled />
        );
    }
}

export class Player extends React.Component {
    constructor(props) {
        super(props);
        this.handleTimeout = this.handleTimeout.bind(this);
        this.handlePacket = this.handlePacket.bind(this);
        this.handleError = this.handleError.bind(this);
        this.handleTitleChange = this.handleTitleChange.bind(this);
        this.handleRewindToStart = this.handleRewindToStart.bind(this);
        this.handlePlayPauseToggle = this.handlePlayPauseToggle.bind(this);
        this.play = this.play.bind(this);
        this.pause = this.pause.bind(this);
        this.handleSpeedUp = this.handleSpeedUp.bind(this);
        this.handleSpeedDown = this.handleSpeedDown.bind(this);
        this.handleSpeedReset = this.handleSpeedReset.bind(this);
        this.handleFastForwardToEnd = this.handleFastForwardToEnd.bind(this);
        this.handleSkipFrame = this.handleSkipFrame.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.sync = this.sync.bind(this);
        this.handleZoomIn = this.handleZoomIn.bind(this);
        this.handleZoomOut = this.handleZoomOut.bind(this);
        this.handleFitTo = this.handleFitTo.bind(this);
        this.handleDragPan = this.handleDragPan.bind(this);
        this.dragPanEnable = this.dragPanEnable.bind(this);
        this.dragPanDisable = this.dragPanDisable.bind(this);
        this.zoom = this.zoom.bind(this);
        this.fastForwardToTS = this.fastForwardToTS.bind(this);
        this.sendInput = this.sendInput.bind(this);
        this.clearInputPlayer = this.clearInputPlayer.bind(this);
        this.handleInfoClick = this.handleInfoClick.bind(this);
        this.wrapperRef = React.createRef();
        this.termRef = React.createRef();
        this.handleProgressClick = this.handleProgressClick.bind(this);

        this.state = {
            cols:               80,
            rows:               25,
            title:              _("Player"),
            paused:             true,
            /* Terminal */
            term:               new Term({
                cols: 80,
                rows: 25,
                screenKeys: true,
                useStyle: true,
                /* Exposes the xterm-accessibility-tree */
                screenReaderMode: true,
            }),
            /* Speed exponent */
            speedExp:           0,
            scale_initial:      1,
            scale_lock:         false,
            term_top_style:     "50%",
            term_left_style:    "50%",
            term_translate:     "-50%, -50%",
            term_scroll:        "hidden",
            term_zoom_max:      false,
            term_zoom_min:      false,
            drag_pan:           false,
            containerWidth: 800,
            scale:          1,
            input:          "",
            mark:           0,
            infoEnabled:    false,
            curTS:          0,
        };

        this.containerHeight = 400;

        this.setScrollwrapRef = element => {
            this.scrollwrapRef = element;
        };

        /* Auto-loading buffer of recording's packets */
        this.error_service = new ErrorService();
        this.reportError = this.error_service.addMessage;
        this.buf = new PacketBuffer(this.props.matchList, this.reportError);

        /* Current recording time, ms */
        this.recTS = 0;
        /* Corresponding local time, ms */
        this.locTS = 0;

        /* Index of the current packet */
        this.pktIdx = 0;
        /* Current packet, or null if not retrieved */
        this.pkt = null;
        /* Timeout ID of the current packet, null if none */
        this.timeout = null;

        /* True if the next packet should be output without delay */
        this.skip = false;
        /* Playback speed */
        this.speed = 1;
        /*
         * Timestamp playback should fast-forward to.
         * Recording time, ms, or null if not fast-forwarding.
         */
        this.fastForwardTo = null;
    }

    reset() {
        /* Clear any pending timeouts */
        this.clearTimeout();

        /* Reset the terminal */
        this.state.term.reset();

        /* Move to beginning of buffer */
        this.pktIdx = 0;
        /* No packet loaded */
        this.pkt = null;

        /* We are not skipping */
        this.skip = false;
        /* We are not fast-forwarding */
        this.fastForwardTo = null;

        /* Move to beginning of recording */
        this.recTS = 0;
        /* Start the playback time */
        this.locTS = performance.now();

        /* Wait for the first packet */
        this.awaitPacket(0);
    }

    /* Subscribe for a packet at specified index */
    awaitPacket(idx) {
        this.buf.awaitPacket(idx).done(this.handlePacket)
                .fail(this.handleError);
    }

    /* Set next packet timeout, ms */
    setTimeout(ms) {
        this.timeout = window.setTimeout(this.handleTimeout, ms);
    }

    /* Clear next packet timeout */
    clearTimeout() {
        if (this.timeout !== null) {
            window.clearTimeout(this.timeout);
            this.timeout = null;
        }
    }

    /* Handle packet retrieval error */
    handleError(error) {
        if (error !== null) {
            this.reportError(error);
            console.warn(error);
        }
    }

    /* Handle packet retrieval success */
    handlePacket() {
        this.sync();
    }

    /* Handle arrival of packet output time */
    handleTimeout() {
        this.timeout = null;
        this.sync();
    }

    /* Handle terminal title change */
    handleTitleChange(title) {
        this.setState({ title: _("Player") + ": " + title });
    }

    _transform(width, height) {
        const relation = Math.min(
            this.state.containerWidth / this.state.term.element.offsetWidth,
            this.containerHeight / this.state.term.element.offsetHeight
        );
        this.setState({
            term_top_style: "50%",
            term_left_style: "50%",
            term_translate: "-50%, -50%",
            scale: relation,
            scale_initial: relation,
            cols: width,
            rows: height
        });
    }

    sendInput(pkt) {
        if (pkt) {
            const current_input = this.state.input;
            this.setState({ input: current_input + pkt.io });
        }
    }

    /* Synchronize playback */
    sync() {
        let locDelay;

        /* We are already called, don't call us with timeout */
        this.clearTimeout();

        /* Forever */
        for (;;) {
            /* Get another packet to output, if none */
            for (; this.pkt === null; this.pktIdx++) {
                const pkt = this.buf.pktList[this.pktIdx];
                /* If there are no more packets */
                if (pkt === undefined) {
                    /*
                     * If we're done loading existing packets and we were
                     * fast-forwarding.
                     */
                    if (this.fastForwardTo != null && this.buf.isDone()) {
                        /* Stop fast-forwarding */
                        this.fastForwardTo = null;
                    }
                    /* Call us when we get one */
                    this.awaitPacket();
                    return;
                }

                this.pkt = pkt;
            }

            /* Get the current local time */
            const nowLocTS = performance.now();

            /* Ignore the passed time, if we're paused */
            if (this.state.paused) {
                locDelay = 0;
            } else {
                locDelay = nowLocTS - this.locTS;
            }

            /* Sync to the local time */
            this.locTS = nowLocTS;

            /* If we are skipping one packet's delay */
            if (this.skip) {
                this.skip = false;
                this.recTS = this.pkt.pos;
            /* Else, if we are fast-forwarding */
            } else if (this.fastForwardTo !== null) {
                /* If we haven't reached fast-forward destination */
                if (this.pkt.pos < this.fastForwardTo) {
                    this.recTS = this.pkt.pos;
                } else {
                    this.recTS = this.fastForwardTo;
                    this.fastForwardTo = null;
                    continue;
                }
            /* Else, if we are paused */
            } else if (this.state.paused) {
                return;
            } else {
                this.recTS += locDelay * this.speed;
                const pktRecDelay = this.pkt.pos - this.recTS;
                const pktLocDelay = pktRecDelay / this.speed;
                /* If we're more than 5 ms early for this packet */
                if (pktLocDelay > 5) {
                    /* Call us again on time, later */
                    this.setTimeout(pktLocDelay);
                    return;
                }
            }

            /* Send packet ts to the top */
            if (this.props.logsEnabled) {
                this.props.onTsChange(this.pkt.pos);
            }
            this.setState({ curTS: this.pkt.pos });

            /* Output the packet */
            if (this.pkt.is_io && !this.pkt.is_output) {
                this.sendInput(this.pkt);
            } else if (this.pkt.is_io) {
                this.state.term.write(this.pkt.io);
            } else {
                this.state.term.resize(this.pkt.width, this.pkt.height);
                if (!this.state.scale_lock) {
                    this._transform(this.pkt.width, this.pkt.height);
                }
            }

            /* We no longer have a packet */
            this.pkt = null;
        }
    }

    handlePlayPauseToggle() {
        this.setState({ paused: !this.state.paused });
    }

    play() {
        this.setState({ paused: false });
    }

    pause() {
        this.setState({ paused: true });
    }

    handleSpeedUp() {
        const speedExp = this.state.speedExp;
        if (speedExp < 4) {
            this.setState({ speedExp: speedExp + 1 });
        }
    }

    handleSpeedDown() {
        const speedExp = this.state.speedExp;
        if (speedExp > -4) {
            this.setState({ speedExp: speedExp - 1 });
        }
    }

    handleSpeedReset() {
        this.setState({ speedExp: 0 });
    }

    clearInputPlayer() {
        this.setState({ input: "" });
    }

    handleRewindToStart() {
        this.clearInputPlayer();
        this.reset();
        this.sync();
        if (this.props.logsEnabled) {
            this.props.onRewindStart();
        }
    }

    handleFastForwardToEnd() {
        this.fastForwardTo = Infinity;
        this.sync();
    }

    fastForwardToTS(ts) {
        if (ts < this.recTS) {
            this.reset();
        }
        this.fastForwardTo = ts;
        this.sync();
    }

    handleSkipFrame() {
        this.skip = true;
        this.sync();
    }

    handleKeyDown(event) {
        const keyCodesFuncs = {
            P: this.handlePlayPauseToggle,
            "}": this.handleSpeedUp,
            "{": this.handleSpeedDown,
            Backspace: this.handleSpeedReset,
            ".": this.handleSkipFrame,
            G: this.handleFastForwardToEnd,
            R: this.handleRewindToStart,
            "+": this.handleZoomIn,
            "=": this.handleZoomIn,
            "-": this.handleZoomOut,
            Z: this.fitIn,
        };
        if (event.target.nodeName.toLowerCase() !== 'input') {
            if (keyCodesFuncs[event.key]) {
                (keyCodesFuncs[event.key](event));
            }
        }
    }

    zoom(scale) {
        if (scale.toFixed(6) === this.state.scale_initial.toFixed(6)) {
            this.handleFitTo();
        } else {
            this.setState({
                term_top_style: "0",
                term_left_style: "0",
                term_translate: "0, 0",
                scale_lock: true,
                term_scroll: "auto",
                scale,
                term_zoom_max: false,
                term_zoom_min: false,
            });
        }
    }

    handleDragPan() {
        (this.state.drag_pan ? this.dragPanDisable() : this.dragPanEnable());
    }

    dragPanEnable() {
        this.setState({ drag_pan: true });

        const scrollwrap = this.scrollwrapRef;

        let clicked = false;
        let clickX;
        let clickY;

        $(this.scrollwrapRef).on({
            mousemove: function(e) {
                clicked && updateScrollPos(e);
            },
            mousedown: function(e) {
                clicked = true;
                clickY = e.pageY;
                clickX = e.pageX;
            },
            mouseup: function() {
                clicked = false;
                $('html').css('cursor', 'auto');
            }
        });

        const updateScrollPos = function(e) {
            $('html').css('cursor', 'move');
            $(scrollwrap).scrollTop($(scrollwrap).scrollTop() + (clickY - e.pageY));
            $(scrollwrap).scrollLeft($(scrollwrap).scrollLeft() + (clickX - e.pageX));
        };
    }

    dragPanDisable() {
        this.setState({ drag_pan: false });
        const scrollwrap = this.scrollwrapRef;
        $(scrollwrap).off("mousemove");
        $(scrollwrap).off("mousedown");
        $(scrollwrap).off("mouseup");
    }

    handleZoomIn() {
        let scale = this.state.scale;
        if (scale < 2.1) {
            scale = scale + 0.1;
            this.zoom(scale);
        } else {
            this.setState({ term_zoom_max: true });
        }
    }

    handleZoomOut() {
        let scale = this.state.scale;
        if (scale >= 0.2) {
            scale = scale - 0.1;
            this.zoom(scale);
        } else {
            this.setState({ term_zoom_min: true });
        }
    }

    handleFitTo() {
        this.setState({
            term_top_style: "50%",
            term_left_style: "50%",
            term_translate: "-50%, -50%",
            scale_lock: false,
            term_scroll: "hidden",
        });
        this._transform();
    }

    componentDidMount() {
        this.state.term.onData((data) => {
            this.handleTitleChange();
        });

        window.addEventListener("keydown", this.handleKeyDown, false);

        if (this.wrapperRef.offsetWidth) {
            this.setState({ containerWidth: this.wrapperRef.offsetWidth });
        }
        /* Open the terminal */
        this.state.term.open(this.termRef.current);
        window.setInterval(this.sync, 100);
        /* Reset playback */
        this.reset();
        this.fastForwardToTS(0);
    }

    componentDidUpdate(prevProps, prevState) {
        /* If we changed pause state or speed exponent */
        if (this.state.paused !== prevState.paused ||
            this.state.speedExp !== prevState.speedExp) {
            this.speed = Math.pow(2, this.state.speedExp);
            this.sync();
        }
        if (this.state.input !== prevState.input) {
            scrollToBottom("input-textarea");
        }
        if (prevProps.logsTs !== this.props.logsTs) {
            this.fastForwardToTS(this.props.logsTs);
        }
    }

    handleInfoClick() {
        this.setState({ infoEnabled: !this.state.infoEnabled });
    }

    handleProgressClick(e) {
        const progress = Math.min(1, Math.max(0, e.clientX / $(".pf-c-progress__bar").width()));
        const ts = Math.round(progress * this.buf.pos);
        this.fastForwardToTS(ts);
    }

    render() {
        const r = this.props.recording;

        const speedExp = this.state.speedExp;
        const speedFactor = Math.pow(2, Math.abs(speedExp));
        let speedStr;

        if (speedExp > 0) {
            speedStr = "x" + speedFactor;
        } else if (speedExp < 0) {
            speedStr = "/" + speedFactor;
        } else {
            speedStr = "";
        }

        const style = {
            transform: "scale(" + this.state.scale + ") translate(" + this.state.term_translate + ")",
            transformOrigin: "top left",
            display: "inline-block",
            margin: "0 auto",
            position: "absolute",
            top: this.state.term_top_style,
            left: this.state.term_left_style,
        };

        const scrollwrap = {
            minWidth: "630px",
            height: this.containerHeight + "px",
            backgroundColor: "#f5f5f5",
            overflow: this.state.term_scroll,
            position: "relative",
        };

        const timeStr = formatDuration(this.state.curTS) +
            " / " +
            formatDuration(this.buf.pos);

        const progress = (
            <Progress
                min={0}
                max={this.buf.pos}
                valueText={timeStr}
                label={timeStr}
                value={this.state.curTS}
                onClick={this.handleProgressClick}
                aria-label="Player Progress"
            />
        );

        const playbackControls = (
            <ToolbarGroup variant="icon-button-group">
                <ToolbarItem>
                    <Button
                    variant="plain"
                    id="player-play-pause"
                    title="Play/Pause - Hotkey: p"
                    type="button"
                    onClick={this.handlePlayPauseToggle}
                    >
                        {this.state.paused ? <PlayIcon /> : <PauseIcon />}
                    </Button>
                </ToolbarItem>
                <ToolbarItem>
                    <Button
                    variant="plain"
                    id="player-skip-frame"
                    title="Skip Frame - Hotkey: ."
                    type="button"
                    onClick={this.handleSkipFrame}
                    >
                        <ArrowRightIcon />
                    </Button>
                </ToolbarItem>
                <ToolbarItem>
                    <Button
                    variant="plain"
                    id="player-restart"
                    title="Restart Playback - Hotkey: Shift-R"
                    type="button"
                    onClick={this.handleRewindToStart}
                    >
                        <UndoIcon />
                    </Button>
                </ToolbarItem>
                <ToolbarItem>
                    <Button
                    variant="plain"
                    id="player-fast-forward"
                    title="Fast-forward to end - Hotkey: Shift-G"
                    type="button"
                    onClick={this.handleFastForwardToEnd}
                    >
                        <RedoIcon />
                    </Button>
                </ToolbarItem>
                <ToolbarItem>
                    <Button
                    variant="plain"
                    id="player-speed-down"
                    title="Speed /2 - Hotkey: {"
                    type="button"
                    onClick={this.handleSpeedDown}
                    >
                        /2
                    </Button>
                </ToolbarItem>
                <ToolbarItem>
                    <Button
                    variant="plain"
                    id="player-speed-up"
                    title="Speed x2 - Hotkey: }"
                    type="button"
                    onClick={this.handleSpeedUp}
                    >
                        x2
                    </Button>
                </ToolbarItem>
                {speedStr !== "" &&
                <ToolbarItem>
                    <ChipGroup categoryName="speed">
                        <Chip onClick={this.handleSpeedReset}>
                            <span id="player-speed">{speedStr}</span>
                        </Chip>
                    </ChipGroup>
                </ToolbarItem>}
            </ToolbarGroup>
        );

        const visualControls = (
            <ToolbarGroup variant="icon-button-group" align={{ default: 'alignRight' }}>
                <ToolbarItem>
                    <Button
                    variant="plain"
                    id="player-drag-pan"
                    title="Drag'n'Pan"
                    onClick={this.handleDragPan}
                    >
                        {this.state.drag_pan ? <ThumbtackIcon /> : <MigrationIcon />}
                    </Button>
                </ToolbarItem>
                <ToolbarItem>
                    <Button
                    variant="plain"
                    id="player-zoom-in"
                    title="Zoom In - Hotkey: ="
                    type="button"
                    onClick={this.handleZoomIn}
                    disabled={this.state.term_zoom_max}
                    >
                        <SearchPlusIcon />
                    </Button>
                </ToolbarItem>
                <ToolbarItem>
                    <Button
                    variant="plain"
                    id="player-fit-to"
                    title="Fit To - Hotkey: Z"
                    type="button"
                    onClick={this.handleFitTo}
                    >
                        <ExpandIcon />
                    </Button>
                </ToolbarItem>
                <ToolbarItem>
                    <Button
                    variant="plain"
                    id="player-zoom-out"
                    title="Zoom Out - Hotkey: -"
                    type="button"
                    onClick={this.handleZoomOut}
                    disabled={this.state.term_zoom_min}
                    >
                        <SearchMinusIcon />
                    </Button>
                </ToolbarItem>
            </ToolbarGroup>
        );

        const panel = (
            <Toolbar>
                <ToolbarContent>
                    {playbackControls}
                    {visualControls}
                    <InputPlayer input={this.state.input} />
                    <Search
                            matchList={this.props.matchList}
                            fastForwardToTS={this.fastForwardToTS}
                            play={this.play}
                            pause={this.pause}
                            paused={this.state.paused}
                            errorService={this.error_service}
                    />
                    <ErrorList list={this.error_service.errors} />
                </ToolbarContent>
            </Toolbar>
        );

        const recordingInfo = (
            <DataList isCompact>
                {
                    [
                        { name: _("ID"), value: r.id },
                        { name: _("Hostname"), value: r.hostname },
                        { name: _("Boot ID"), value: r.boot_id },
                        { name: _("Session ID"), value: r.session_id },
                        { name: _("PID"), value: r.pid },
                        { name: _("Start"), value: formatDateTime(r.start) },
                        { name: _("End"), value: formatDateTime(r.end) },
                        { name: _("Duration"), value: formatDuration(r.end - r.start) },
                        { name: _("User"), value: r.user }
                    ].map((item, index) =>
                        <DataListItem key={index}>
                            <DataListItemRow>
                                <DataListItemCells
                                    dataListCells={[
                                        <DataListCell key="name">{item.name}</DataListCell>,
                                        <DataListCell key="value">{item.value}</DataListCell>
                                    ]}
                                />
                            </DataListItemRow>
                        </DataListItem>
                    )
                }
            </DataList>
        );

        const infoSection = (
            <ExpandableSection
                id="btn-recording-info"
                toggleText={_("Recording Info")}
                onToggle={this.handleInfoClick}
                isExpanded={this.state.infoEnabled === true}
            >
                {recordingInfo}
            </ExpandableSection>
        );

        // ensure react never reuses this div by keying it with the terminal widget
        return (
            <>
                <div ref={this.wrapperRef} className="panel panel-default">
                    <div className="panel-heading">
                        <span>{this.state.title}</span>
                    </div>
                    <div className="panel-body">
                        <div
                            className={(this.state.drag_pan ? "dragnpan" : "")}
                            style={scrollwrap}
                            ref={this.setScrollwrapRef}
                        >
                            <div
                                ref={this.termRef}
                                className="console-ct"
                                key={this.state.term}
                                style={style}
                            />
                        </div>
                    </div>
                    {progress}
                    {panel}
                </div>
                {infoSection}
            </>
        );
    }

    componentWillUnmount() {
        this.buf.stop();
        window.removeEventListener("keydown", this.handleKeyDown, false);
        this.state.term.dispose();
    }
}
