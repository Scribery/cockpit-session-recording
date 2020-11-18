FROM fedora:32

COPY . cockpit-session-recording

RUN sudo dnf -y install \
        git \
        gnupg \
        intltool \
        libappstream-glib \
        make \
        npm \
        rpm-build \
        rpmdevtools \
        rsync \
        tar \
        cockpit-packagekit

RUN cd cockpit-session-recording && make rpm
