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
    Button,
    Form,
    FormGroup,
    FormSelect,
    FormSelectOption,
    TextInput,
    ActionGroup,
    Spinner,
    Card,
    CardTitle,
    CardBody,
    Checkbox,
    Bullseye,
    EmptyState,
    EmptyStateIcon,
    Title,
    EmptyStateBody,
    EmptyStateVariant
} from "@patternfly/react-core";
import { AngleLeftIcon, ExclamationCircleIcon } from "@patternfly/react-icons";
import { global_danger_color_200 } from "@patternfly/react-tokens";

const json = require('comment-json');
const ini = require('ini');
const cockpit = require('cockpit');
const _ = cockpit.gettext;

class GeneralConfig extends React.Component {
    constructor(props) {
        super(props);
        this.handleSubmit = this.handleSubmit.bind(this);
        this.setConfig = this.setConfig.bind(this);
        this.fileReadFailed = this.fileReadFailed.bind(this);
        this.readConfig = this.readConfig.bind(this);
        this.file = null;
        this.config = null;
        this.state = {
            config_loaded: false,
            file_error: false,
            submitting: false,
            shell: "",
            notice: "",
            latency: "",
            payload: "",
            log_input: false,
            log_output: true,
            log_window: true,
            limit_rate: "",
            limit_burst: "",
            limit_action: "",
            file_path: "",
            syslog_facility: "",
            syslog_priority: "",
            journal_augment: "",
            journal_priority: "",
            writer: "",
        };
    }

    handleSubmit(event) {
        this.setState({ submitting: true });
        const config = {
            shell:  this.state.shell,
            notice:  this.state.notice,
            latency:  parseInt(this.state.latency),
            payload:  parseInt(this.state.payload),
            log:  {
                input:  this.state.log_input,
                output:  this.state.log_output,
                window:  this.state.log_window,
            },
            limit:  {
                rate:  parseInt(this.state.limit_rate),
                burst:  parseInt(this.state.limit_burst),
                action:  this.state.limit_action,
            },
            file:  {
                path:  this.state.file_path,
            },
            syslog:  {
                facility:  this.state.syslog_facility,
                priority:  this.state.syslog_priority,
            },
            journal:  {
                priority:  this.state.journal_priority,
                augment:  this.state.journal_augment
            },
            writer:  this.state.writer
        };
        this.file.replace(config).done(() => {
            this.setState({ submitting: false });
        })
                .fail((error) => {
                    console.log(error);
                });
        event.preventDefault();
    }

    setConfig(data) {
        delete data.configuration;
        delete data.args;
        var flattenObject = function(ob) {
            var toReturn = {};

            for (var i in ob) {
                if (!Object.prototype.hasOwnProperty.call(ob, i)) continue;

                if ((typeof ob[i]) == 'object') {
                    var flatObject = flattenObject(ob[i]);
                    for (var x in flatObject) {
                        if (!Object.prototype.hasOwnProperty.call(flatObject, x)) continue;

                        toReturn[i + '_' + x] = flatObject[x];
                    }
                } else {
                    toReturn[i] = ob[i];
                }
            }
            return toReturn;
        };
        const state = flattenObject(data);
        state.config_loaded = true;
        this.setState(state);
    }

    getConfig() {
        const proc = cockpit.spawn(["tlog-rec-session", "--configuration"]);

        proc.stream((data) => {
            this.setConfig(json.parse(data, null, true));
            proc.close();
        });

        proc.fail((fail) => {
            console.log(fail);
            this.readConfig();
        });
    }

    readConfig() {
        const parseFunc = function(data) {
            return json.parse(data, null, true);
        };

        const stringifyFunc = function(data) {
            return json.stringify(data, null, true);
        };
        // needed for cockpit.file usage
        const syntax_object = {
            parse: parseFunc,
            stringify: stringifyFunc,
        };

        this.file = cockpit.file("/etc/tlog/tlog-rec-session.conf", {
            syntax: syntax_object,
            superuser: true,
        });
    }

    fileReadFailed(reason) {
        console.log(reason);
        this.setState({ file_error: reason });
    }

    componentDidMount() {
        this.getConfig();
        this.readConfig();
    }

    render() {
        const form =
            (this.state.config_loaded === false && this.state.file_error === false)
                ? <Spinner />
                : (this.state.config_loaded === true && this.state.file_error === false)
                    ? (
                        <Form isHorizontal>
                            <FormGroup label={_("Shell")}>
                                <TextInput
                                    id="shell"
                                    value={this.state.shell}
                                    onChange={shell => this.setState({ shell })} />
                            </FormGroup>
                            <FormGroup label={_("Notice")}>
                                <TextInput
                                    id="notice"
                                    value={this.state.notice}
                                    onChange={notice => this.setState({ notice })} />
                            </FormGroup>
                            <FormGroup label={_("Latency")}>
                                <TextInput
                                    id="latency"
                                    type="number"
                                    step="1"
                                    value={this.state.latency}
                                    onChange={latency => this.setState({ latency })} />
                            </FormGroup>
                            <FormGroup label={_("Payload Size, bytes")}>
                                <TextInput
                                    id="payload"
                                    type="number"
                                    step="1"
                                    value={this.state.payload}
                                    onChange={payload => this.setState({ payload })} />
                            </FormGroup>
                            <FormGroup label={_("Logging")}>
                                <Checkbox
                                    id="log_input"
                                    isChecked={this.state.log_input}
                                    onChange={log_input => this.setState({ log_input })}
                                    label={_("User's Input")} />
                                <Checkbox
                                    id="log_output"
                                    isChecked={this.state.log_output}
                                    onChange={log_output => this.setState({ log_output })}
                                    label={_("User's Output")} />
                                <Checkbox
                                    id="log_window"
                                    isChecked={this.state.log_window}
                                    onChange={log_window => this.setState({ log_window })}
                                    label={_("Window Resize")} />
                            </FormGroup>
                            <FormGroup label={_("Limit Rate, bytes/sec")}>
                                <TextInput
                                    id="limit_rate"
                                    type="number"
                                    step="1"
                                    value={this.state.limit_rate}
                                    onChange={limit_rate => this.setState({ limit_rate })} />
                            </FormGroup>
                            <FormGroup label={_("Burst, bytes")}>
                                <TextInput
                                    id="limit_burst"
                                    type="number"
                                    step="1"
                                    value={this.state.limit_burst}
                                    onChange={limit_burst => this.setState({ limit_burst })} />
                            </FormGroup>
                            <FormGroup label={_("Logging Limit Action")}>
                                <FormSelect
                                    id="limit_action"
                                    value={this.state.limit_action}
                                    onChange={limit_action => this.setState({ limit_action })}>
                                    {[
                                        { value: "", label: "" },
                                        { value: "pass", label: _("Pass") },
                                        { value: "delay", label: _("Delay") },
                                        { value: "drop", label: _("Drop") }
                                    ].map((option, index) =>
                                        <FormSelectOption
                                        key={index}
                                        value={option.value}
                                        label={option.label} />
                                    )}
                                </FormSelect>
                            </FormGroup>
                            <FormGroup label={_("File Path")}>
                                <TextInput
                                    id="file_path"
                                    value={this.state.file_path}
                                    onChange={file_path => this.setState({ file_path })} />
                            </FormGroup>
                            <FormGroup label={_("Syslog Facility")}>
                                <TextInput
                                    id="syslog_facility"
                                    value={this.state.syslog_facility}
                                    onChange={syslog_facility =>
                                        this.setState({ syslog_facility })} />
                            </FormGroup>
                            <FormGroup label={_("Syslog Priority")}>
                                <FormSelect
                                    id="syslog_priority"
                                    value={this.state.syslog_priority}
                                    onChange={syslog_priority =>
                                        this.setState({ syslog_priority })}>
                                    {[
                                        { value: "", label: "" },
                                        { value: "info", label: _("Info") },
                                    ].map((option, index) =>
                                        <FormSelectOption
                                        key={index}
                                        value={option.value}
                                        label={option.label} />
                                    )}
                                </FormSelect>
                            </FormGroup>
                            <FormGroup label={_("Journal Priority")}>
                                <FormSelect
                                    id="journal_priority"
                                    value={this.state.journal_priority}
                                    onChange={journal_priority =>
                                        this.setState({ journal_priority })}>
                                    {[
                                        { value: "", label: "" },
                                        { value: "info", label: _("Info") },
                                    ].map((option, index) =>
                                        <FormSelectOption
                                        key={index}
                                        value={option.value}
                                        label={option.label} />
                                    )}
                                </FormSelect>
                            </FormGroup>
                            <FormGroup>
                                <Checkbox
                                    id="journal_augment"
                                    isChecked={this.state.journal_augment}
                                    onChange={journal_augment =>
                                        this.setState({ journal_augment })}
                                    label={_("Augment")} />
                            </FormGroup>
                            <FormGroup label={_("Writer")}>
                                <FormSelect
                                    id="writer"
                                    value={this.state.writer}
                                    onChange={writer =>
                                        this.setState({ writer })}>
                                    {[
                                        { value: "", label: "" },
                                        { value: "journal", label: _("Journal") },
                                        { value: "syslog", label: _("Syslog") },
                                        { value: "file", label: _("File") },
                                    ].map((option, index) =>
                                        <FormSelectOption
                                        key={index}
                                        value={option.value}
                                        label={option.label} />
                                    )}
                                </FormSelect>
                            </FormGroup>
                            <ActionGroup>
                                <Button
                                    id="btn-save-tlog-conf"
                                    variant="primary"
                                    onClick={this.handleSubmit}>
                                    {_("Save")}
                                </Button>
                                {this.state.submitting === true && <Spinner size="lg" />}
                            </ActionGroup>
                        </Form>
                    )
                    : (
                        <Bullseye>
                            <EmptyState variant={EmptyStateVariant.small}>
                                <EmptyStateIcon
                                icon={ExclamationCircleIcon}
                                color={global_danger_color_200.value} />
                                <Title headingLevel="h4" size="lg">
                                    {_("There is no configuration file of tlog present in your system.")}
                                </Title>
                                <Title headingLevel="h4" size="lg">
                                    {_("Please, check the /etc/tlog/tlog-rec-session.conf or if tlog is installed.")}
                                </Title>
                                <EmptyStateBody>
                                    {this.state.file_error}
                                </EmptyStateBody>
                            </EmptyState>
                        </Bullseye>
                    );

        return (
            <Card>
                <CardTitle>General Config</CardTitle>
                <CardBody style={{ maxWidth: "500px" }}>{form}</CardBody>
            </Card>
        );
    }
}

class SssdConfig extends React.Component {
    constructor(props) {
        super(props);
        this.handleSubmit = this.handleSubmit.bind(this);
        this.setConfig = this.setConfig.bind(this);
        this.confSave = this.confSave.bind(this);
        this.file = null;
        this.state = {
            scope: "",
            users: "",
            groups: "",
            submitting: false,
        };
    }

    confSave(obj) {
        this.setState({ submitting: true });
        this.file.replace(obj).done(() => {
            cockpit.spawn(
                ["chmod", "600", "/etc/sssd/conf.d/sssd-session-recording.conf"],
                { superuser: "require" }).done(() => {
                cockpit.spawn(
                    ["systemctl", "restart", "sssd"],
                    { superuser: "require" }).done(() => {
                    this.setState({ submitting: false });
                })
                        .fail((data) => console.log(data));
            })
                    .fail((data) => console.log(data));
        });
    }

    setConfig(data) {
        if (data === null) {
            const obj = {};
            obj.session_recording = {};
            obj.session_recording.scope = "none";
            this.confSave(obj);
        } else {
            const config = { ...data.session_recording };
            this.setState(config);
        }
    }

    componentDidMount() {
        const syntax_object = {
            parse:     ini.parse,
            stringify: ini.stringify
        };

        this.file = cockpit.file("/etc/sssd/conf.d/sssd-session-recording.conf", {
            syntax: syntax_object,
            superuser: true,
        });

        const promise = this.file.read();

        promise.done(() => this.file.watch(this.setConfig));

        promise.fail(function(error) {
            console.log(error);
        });
    }

    handleSubmit(e) {
        const obj = {};
        obj.session_recording = {};
        obj.session_recording.scope = this.state.scope;
        obj.session_recording.users = this.state.users;
        obj.session_recording.groups = this.state.groups;
        this.confSave(obj);
        e.preventDefault();
    }

    render() {
        const form = (
            <Form isHorizontal>
                <FormGroup label="Scope">
                    <FormSelect
                        id="scope"
                        value={this.state.scope}
                        onChange={scope => this.setState({ scope })}>
                        {[
                            { value: "none", label: _("None") },
                            { value: "some", label: _("Some") },
                            { value: "all", label: _("All") }
                        ].map((option, index) =>
                            <FormSelectOption
                                key={index}
                                value={option.value}
                                label={option.label} />
                        )}
                    </FormSelect>
                </FormGroup>
                {this.state.scope === "some" &&
                <>
                    <FormGroup label={_("Users")}>
                        <TextInput
                            id="users"
                            value={this.state.users}
                            onChange={users => this.setState({ users })}
                        />
                    </FormGroup>
                    <FormGroup label={_("Groups")}>
                        <TextInput
                            id="groups"
                            value={this.state.groups}
                            onChange={groups => this.setState({ groups })}
                        />
                    </FormGroup>
                </>}
                <ActionGroup>
                    <Button
                        id="btn-save-sssd-conf"
                        variant="primary"
                        onClick={this.handleSubmit}>
                        {_("Save")}
                    </Button>
                    {this.state.submitting === true && <Spinner size="lg" />}
                </ActionGroup>
            </Form>
        );

        return (
            <Card>
                <CardTitle>SSSD Config</CardTitle>
                <CardBody style={{ maxWidth: "500px" }}>{form}</CardBody>
            </Card>
        );
    }
}

export function Config () {
    const goBack = () => {
        cockpit.location.go("/");
    };

    return (
        <>
            <Button variant="link" icon={<AngleLeftIcon />} onClick={goBack}>
                {_("Session Recording")}
            </Button>
            <GeneralConfig />
            <SssdConfig />
        </>
    );
}
