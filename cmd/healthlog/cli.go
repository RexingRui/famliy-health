package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"golang.org/x/term"

	"github.com/rexingrui/famliy-health/internal/service"
	"github.com/rexingrui/famliy-health/internal/storage"
)

func userCommand(ctx context.Context, args []string) error {
	if len(args) == 0 {
		return errors.New("usage: healthlog user create|passwd --username NAME")
	}
	fs := flag.NewFlagSet("user "+args[0], flag.ContinueOnError)
	username := fs.String("username", "", "login name")
	displayName := fs.String("display-name", "", "name shown in the app (defaults to username)")
	familyName := fs.String("family-name", "我的家", "family name, used when creating the first account")
	passwordStdin := fs.Bool("password-stdin", false, "read the password from standard input")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	if *username == "" {
		return errors.New("--username is required")
	}

	cfg, st, err := openStore(ctx)
	if err != nil {
		return err
	}
	defer st.Pool.Close()
	files, err := storage.NewLocal(cfg.StorageDir)
	if err != nil {
		return err
	}
	svc := service.New(st, files, nil)

	password, err := readPassword(*passwordStdin)
	if err != nil {
		return err
	}
	switch args[0] {
	case "create":
		acct, err := svc.CreateAccount(ctx, *username, password, *displayName, *familyName)
		if err != nil {
			return err
		}
		fmt.Printf("created account %q (%s)\n", acct.Username, acct.ID)
	case "passwd":
		if err := svc.SetPassword(ctx, *username, password); err != nil {
			return err
		}
		fmt.Printf("password updated for %q; all its sessions were signed out\n", *username)
	default:
		return fmt.Errorf("unknown user command %q", args[0])
	}
	return nil
}

func readPassword(fromStdin bool) (string, error) {
	if fromStdin || !term.IsTerminal(int(os.Stdin.Fd())) {
		line, err := bufio.NewReader(os.Stdin).ReadString('\n')
		if err != nil && !errors.Is(err, io.EOF) {
			return "", err
		}
		return strings.TrimRight(line, "\r\n"), nil
	}
	fmt.Fprint(os.Stderr, "Password (at least 8 characters): ")
	first, err := term.ReadPassword(int(os.Stdin.Fd()))
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return "", err
	}
	fmt.Fprint(os.Stderr, "Repeat password: ")
	second, err := term.ReadPassword(int(os.Stdin.Fd()))
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return "", err
	}
	if string(first) != string(second) {
		return "", errors.New("passwords do not match")
	}
	return string(first), nil
}

func purgeData(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("purge-data", flag.ContinueOnError)
	confirm := fs.Bool("confirm", false, "really delete everything")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if !*confirm {
		return errors.New("this deletes all members, records and files; re-run with --confirm")
	}
	cfg, st, err := openStore(ctx)
	if err != nil {
		return err
	}
	defer st.Pool.Close()
	files, err := storage.NewLocal(cfg.StorageDir)
	if err != nil {
		return err
	}
	fam, err := st.FirstFamily(ctx)
	if err != nil {
		return fmt.Errorf("no family found: %w", err)
	}
	if err := service.New(st, files, nil).DeleteFamilyData(ctx, fam.ID); err != nil {
		return err
	}
	fmt.Printf("deleted family %q and all its data; accounts remain and can be removed in the database\n", fam.Name)
	return nil
}
